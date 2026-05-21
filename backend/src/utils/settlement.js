import { all, get } from '../db/index.js';

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function buildMonthFilter(columnName, month) {
  if (!month) {
    return {
      clause: '',
      params: []
    };
  }

  return {
    clause: ` AND substr(${columnName}, 1, 7) = ?`,
    params: [month]
  };
}

/**
 * Calculate settlement for a group
 *
 * Flow:
 * 1. Reduce each member's own expenses by the payments they personally received
 * 2. Sum the remaining group balance
 * 3. Divide that remaining balance equally across all members
 * 4. Compare each member's current net position to their equal share
 */
export async function calculateSettlement(groupId, options = {}) {
  try {
    const { month = null } = options;
    const members = await all(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?`,
      [groupId]
    );

    if (!members || members.length === 0) {
      throw new Error('No members found in group');
    }

    const expenseFilter = buildMonthFilter('expense_date', month);
    const paymentFilter = buildMonthFilter('payment_date', month);

    const expenses = await all(
      `SELECT user_id, SUM(amount) as total_spent
       FROM expenses
       WHERE group_id = ?
       ${expenseFilter.clause}
       GROUP BY user_id`,
      [groupId, ...expenseFilter.params]
    );

    const payments = await all(
      `SELECT user_id, SUM(amount) as total_received
       FROM payments
       WHERE group_id = ?
       ${paymentFilter.clause}
       GROUP BY user_id`,
      [groupId, ...paymentFilter.params]
    );

    const totalPaymentResult = await get(
      `SELECT SUM(amount) as total_received
       FROM payments
       WHERE group_id = ?
       ${paymentFilter.clause}`,
      [groupId, ...paymentFilter.params]
    );

    let totalExpenses = 0;
    const totalReceived = Number(totalPaymentResult?.total_received || 0);
    const expenseMap = {};
    const paymentMap = {};

    expenses.forEach((expense) => {
      const totalSpent = Number(expense.total_spent || 0);
      expenseMap[expense.user_id] = totalSpent;
      totalExpenses += totalSpent;
    });

    payments.forEach((payment) => {
      paymentMap[payment.user_id] = Number(payment.total_received || 0);
    });

    const netProfit = totalReceived - totalExpenses;
    const numberOfMembers = members.length;
    const perPersonShare = netProfit / numberOfMembers;

    const memberBalances = members.map((member) => {
      const amountSpent = expenseMap[member.id] || 0;
      const amountReceived = paymentMap[member.id] || 0;
      const netAfterOwnActivity = amountReceived - amountSpent;
      const balance = perPersonShare - netAfterOwnActivity;

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        amountSpent,
        amountReceived,
        netAfterOwnActivity,
        profitShare: perPersonShare,
        balance
      };
    });

    return {
      month,
      totalReceived: roundCurrency(totalReceived),
      totalExpenses: roundCurrency(totalExpenses),
      netProfit: roundCurrency(netProfit),
      perPersonShare: roundCurrency(perPersonShare),
      numberOfMembers,
      memberBalances: memberBalances.map((member) => ({
        ...member,
        amountSpent: roundCurrency(member.amountSpent),
        amountReceived: roundCurrency(member.amountReceived),
        netAfterOwnActivity: roundCurrency(member.netAfterOwnActivity),
        profitShare: roundCurrency(member.profitShare),
        balance: roundCurrency(member.balance)
      }))
    };
  } catch (error) {
    throw error;
  }
}

export async function getSettlementHistory(groupId) {
  const months = await all(
    `
      SELECT month
      FROM (
        SELECT substr(expense_date, 1, 7) as month
        FROM expenses
        WHERE group_id = ?
        UNION
        SELECT substr(payment_date, 1, 7) as month
        FROM payments
        WHERE group_id = ?
      )
      WHERE month IS NOT NULL
      ORDER BY month DESC
    `,
    [groupId, groupId]
  );

  const history = [];

  for (const row of months) {
    history.push(await calculateSettlement(groupId, { month: row.month }));
  }

  return history;
}

export async function getSettlementSummary(groupId) {
  const settlement = await calculateSettlement(groupId);

  let summary = `
    <h2>Settlement Summary</h2>
    <p><strong>Total Received:</strong> €${settlement.totalReceived}</p>
    <p><strong>Total Expenses:</strong> €${settlement.totalExpenses}</p>
    <p><strong>Net Profit:</strong> €${settlement.netProfit}</p>
    <p><strong>Per Person Share:</strong> €${settlement.perPersonShare}</p>
    <hr/>
    <h3>Member Balances:</h3>
    <table border="1">
      <tr>
        <th>Name</th>
        <th>Spent</th>
        <th>Received</th>
        <th>After Own Activity</th>
        <th>Profit Share</th>
        <th>Balance</th>
      </tr>
  `;

  settlement.memberBalances.forEach((member) => {
    const status = member.balance > 0 ? 'Gets' : member.balance < 0 ? 'Owes' : 'Even';
    summary += `
      <tr>
        <td>${member.name}</td>
        <td>€${member.amountSpent}</td>
        <td>€${member.amountReceived}</td>
        <td>€${member.netAfterOwnActivity}</td>
        <td>€${member.profitShare}</td>
        <td>${status} €${Math.abs(member.balance)}</td>
      </tr>
    `;
  });

  summary += `</table>`;
  return summary;
}
