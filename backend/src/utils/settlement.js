import { all, get } from '../db/index.js';
import { formatCurrency } from './currency.js';

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function fromCents(value) {
  return roundCurrency(Number(value || 0) / 100);
}

export function normalizeMonth(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const month = value.slice(0, 7);
  return /^\d{4}-\d{2}$/.test(month) ? month : null;
}

export function getMonthFromDate(value) {
  return normalizeMonth(value);
}

function createMemberSnapshot(member) {
  return {
    id: member.user_id,
    name: member.name,
    email: member.email,
    amountSpent: 0,
    amountReceived: 0,
    netAfterOwnActivity: 0,
    profitShare: 0,
    balance: 0
  };
}

function ensureMemberBalance(memberBalances, user) {
  if (!memberBalances.has(user.user_id)) {
    memberBalances.set(user.user_id, createMemberSnapshot(user));
  }

  return memberBalances.get(user.user_id);
}

function createEmptySettlement() {
  return {
    totalReceived: 0,
    totalExpenses: 0,
    netProfit: 0,
    perPersonShare: 0,
    numberOfMembers: 0,
    memberBalances: [],
    transferSuggestions: []
  };
}

function buildTransferSuggestions(memberBalances) {
  const creditors = memberBalances
    .filter((member) => roundCurrency(member.balance) > 0)
    .map((member) => ({
      id: member.id,
      name: member.name,
      amount: roundCurrency(member.balance)
    }))
    .sort((left, right) => right.amount - left.amount);
  const debtors = memberBalances
    .filter((member) => roundCurrency(member.balance) < 0)
    .map((member) => ({
      id: member.id,
      name: member.name,
      amount: roundCurrency(Math.abs(member.balance))
    }))
    .sort((left, right) => right.amount - left.amount);
  const suggestions = [];

  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amount = roundCurrency(Math.min(creditor.amount, debtor.amount));

    if (amount > 0) {
      suggestions.push({
        fromUserId: debtor.id,
        fromName: debtor.name,
        toUserId: creditor.id,
        toName: creditor.name,
        amount
      });
    }

    creditor.amount = roundCurrency(creditor.amount - amount);
    debtor.amount = roundCurrency(debtor.amount - amount);

    if (creditor.amount <= 0) {
      creditorIndex += 1;
    }

    if (debtor.amount <= 0) {
      debtorIndex += 1;
    }
  }

  return suggestions;
}

function splitAmountAcrossMembers(totalCents, members) {
  if (members.length === 0) {
    return [];
  }

  const sign = totalCents >= 0 ? 1 : -1;
  const absoluteTotal = Math.abs(totalCents);
  const base = Math.floor(absoluteTotal / members.length);
  let remainder = absoluteTotal % members.length;

  const sortedMembers = [...members].sort((left, right) => left.id.localeCompare(right.id));

  return sortedMembers.map((member) => {
    const share = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }

    return {
      member,
      shareCents: sign * share
    };
  });
}

async function getCurrentGroupMembers(groupId) {
  return all(
    `SELECT gm.group_id, gm.user_id, u.name, u.email
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY LOWER(u.name) ASC`,
    [groupId]
  );
}

async function getUsersByIds(userIds) {
  if (userIds.length === 0) {
    return [];
  }

  const placeholders = userIds.map(() => '?').join(', ');

  return all(
    `SELECT id, name, email
     FROM users
     WHERE id IN (${placeholders})`,
    userIds
  );
}

async function getExpensesForMonth(groupId, month) {
  return all(
    `SELECT e.id, e.user_id, e.amount, e.note, e.expense_date
     FROM expenses e
     WHERE e.group_id = ?
       AND substr(e.expense_date, 1, 7) = ?
     ORDER BY e.expense_date ASC, e.created_at ASC`,
    [groupId, month]
  );
}

async function getPaymentsForMonth(groupId, month) {
  return all(
    `SELECT p.id, p.user_id, p.amount, p.payment_method, p.customer_note, p.payment_date
     FROM payments p
     WHERE p.group_id = ?
       AND substr(p.payment_date, 1, 7) = ?
     ORDER BY p.payment_date ASC, p.created_at ASC`,
    [groupId, month]
  );
}

async function getMonths(groupId, excludeMonths = []) {
  const monthRows = await all(
    `SELECT month
     FROM (
       SELECT substr(expense_date, 1, 7) AS month
       FROM expenses
       WHERE group_id = ?
       UNION
       SELECT substr(payment_date, 1, 7) AS month
       FROM payments
       WHERE group_id = ?
       UNION
       SELECT month
       FROM settled_months
       WHERE group_id = ?
     )
     WHERE month IS NOT NULL
     ORDER BY month DESC`,
    [groupId, groupId, groupId]
  );

  return monthRows
    .map((row) => row.month)
    .filter((month) => !excludeMonths.includes(month));
}

export async function getSettledMonth(groupId, month) {
  const normalizedMonth = normalizeMonth(month);

  if (!normalizedMonth) {
    return null;
  }

  return get(
    `SELECT sm.id, sm.group_id, sm.month, sm.settled_by_user_id, sm.settled_at,
            u.name AS settled_by_name
     FROM settled_months sm
     LEFT JOIN users u ON u.id = sm.settled_by_user_id
     WHERE sm.group_id = ? AND sm.month = ?`,
    [groupId, normalizedMonth]
  );
}

async function getSettledMonthMap(groupId) {
  const settledMonths = await all(
    `SELECT sm.id, sm.group_id, sm.month, sm.settled_by_user_id, sm.settled_at,
            u.name AS settled_by_name
     FROM settled_months sm
     LEFT JOIN users u ON u.id = sm.settled_by_user_id
     WHERE sm.group_id = ?`,
    [groupId]
  );

  return new Map(settledMonths.map((row) => [row.month, row]));
}

async function calculateMonthlySettlement(groupId, month) {
  const [currentMembers, expenses, payments] = await Promise.all([
    getCurrentGroupMembers(groupId),
    getExpensesForMonth(groupId, month),
    getPaymentsForMonth(groupId, month)
  ]);
  const memberBalances = new Map();
  const currentMemberIds = new Set(currentMembers.map((member) => member.user_id));
  const actorIds = new Set([
    ...expenses.map((expense) => expense.user_id),
    ...payments.map((payment) => payment.user_id)
  ]);

  currentMembers.forEach((member) => {
    ensureMemberBalance(memberBalances, member);
  });

  const missingActorIds = [...actorIds].filter((userId) => !memberBalances.has(userId));
  const missingActors = missingActorIds.length
    ? await all(
        `SELECT id, name, email
         FROM users
         WHERE id IN (${missingActorIds.map(() => '?').join(', ')})`,
        missingActorIds
      )
    : [];

  missingActors.forEach((actor) => {
    ensureMemberBalance(memberBalances, {
      user_id: actor.id,
      name: actor.name,
      email: actor.email
    });
  });

  const settlementMembers = [...currentMemberIds]
    .map((memberId) => memberBalances.get(memberId))
    .filter(Boolean);
  let totalExpensesCents = 0;
  let totalReceivedCents = 0;

  expenses.forEach((expense) => {
    const amountCents = toCents(expense.amount);
    if (settlementMembers.length === 0) {
      return;
    }

    const actor = memberBalances.get(expense.user_id);
    const shares = splitAmountAcrossMembers(amountCents, settlementMembers);
    totalExpensesCents += amountCents;

    shares.forEach(({ member, shareCents }) => {
      member.profitShare -= shareCents;
      member.balance -= shareCents;
    });

    if (actor) {
      actor.amountSpent += amountCents;
      actor.netAfterOwnActivity -= amountCents;
      actor.balance += amountCents;
    }
  });

  payments.forEach((payment) => {
    const amountCents = toCents(payment.amount);
    if (settlementMembers.length === 0) {
      return;
    }

    const actor = memberBalances.get(payment.user_id);
    const shares = splitAmountAcrossMembers(amountCents, settlementMembers);
    totalReceivedCents += amountCents;

    shares.forEach(({ member, shareCents }) => {
      member.profitShare += shareCents;
      member.balance += shareCents;
    });

    if (actor) {
      actor.amountReceived += amountCents;
      actor.netAfterOwnActivity += amountCents;
      actor.balance -= amountCents;
    }
  });

  const balances = settlementMembers
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((member) => ({
      ...member,
      amountSpent: fromCents(member.amountSpent),
      amountReceived: fromCents(member.amountReceived),
      netAfterOwnActivity: fromCents(member.netAfterOwnActivity),
      profitShare: fromCents(member.profitShare),
      balance: fromCents(member.balance)
    }));

  const netProfitCents = totalReceivedCents - totalExpensesCents;
  const numberOfMembers = settlementMembers.length;
  const netProfit = fromCents(netProfitCents);
  const perPersonShare = numberOfMembers > 0 ? roundCurrency(netProfit / numberOfMembers) : 0;

  return {
    month,
    totalReceived: fromCents(totalReceivedCents),
    totalExpenses: fromCents(totalExpensesCents),
    netProfit,
    perPersonShare,
    numberOfMembers,
    memberBalances: balances,
    transferSuggestions: buildTransferSuggestions(balances)
  };
}

function aggregateSettlements(monthlySettlements) {
  if (monthlySettlements.length === 0) {
    return createEmptySettlement();
  }

  const memberBalances = new Map();
  let totalReceivedCents = 0;
  let totalExpensesCents = 0;

  monthlySettlements.forEach((settlement) => {
    totalReceivedCents += toCents(settlement.totalReceived);
    totalExpensesCents += toCents(settlement.totalExpenses);

    settlement.memberBalances.forEach((member) => {
      if (!memberBalances.has(member.id)) {
        memberBalances.set(member.id, {
          ...member,
          amountSpent: 0,
          amountReceived: 0,
          netAfterOwnActivity: 0,
          profitShare: 0,
          balance: 0
        });
      }

      const snapshot = memberBalances.get(member.id);
      snapshot.amountSpent += toCents(member.amountSpent);
      snapshot.amountReceived += toCents(member.amountReceived);
      snapshot.netAfterOwnActivity += toCents(member.netAfterOwnActivity);
      snapshot.profitShare += toCents(member.profitShare);
      snapshot.balance += toCents(member.balance);
    });
  });

  const balances = [...memberBalances.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((member) => ({
      ...member,
      amountSpent: fromCents(member.amountSpent),
      amountReceived: fromCents(member.amountReceived),
      netAfterOwnActivity: fromCents(member.netAfterOwnActivity),
      profitShare: fromCents(member.profitShare),
      balance: fromCents(member.balance)
    }));

  const netProfitCents = totalReceivedCents - totalExpensesCents;
  const netProfit = fromCents(netProfitCents);
  const numberOfMembers = balances.length;

  return {
    totalReceived: fromCents(totalReceivedCents),
    totalExpenses: fromCents(totalExpensesCents),
    netProfit,
    perPersonShare: roundCurrency(numberOfMembers > 0 ? netProfit / numberOfMembers : 0),
    numberOfMembers,
    memberBalances: balances,
    transferSuggestions: buildTransferSuggestions(balances)
  };
}

export async function calculateSettlement(groupId, options = {}) {
  const { month = null, excludeSettledMonths = false } = options;

  if (month) {
    return calculateMonthlySettlement(groupId, month);
  }

  const settledMonthMap = excludeSettledMonths ? await getSettledMonthMap(groupId) : new Map();
  const months = await getMonths(groupId, [...settledMonthMap.keys()]);
  const monthlySettlements = [];

  for (const item of months) {
    monthlySettlements.push(await calculateMonthlySettlement(groupId, item));
  }

  return aggregateSettlements(monthlySettlements);
}

export async function getSettlementHistory(groupId) {
  const settledMonthMap = await getSettledMonthMap(groupId);
  const months = await getMonths(groupId);
  const history = [];

  for (const month of months) {
    const monthSettlement = await calculateMonthlySettlement(groupId, month);
    const settledMonth = settledMonthMap.get(month);
    history.push({
      ...monthSettlement,
      isSettled: Boolean(settledMonth),
      settledAt: settledMonth?.settled_at || null,
      settledByUserId: settledMonth?.settled_by_user_id || null,
      settledByName: settledMonth?.settled_by_name || null
    });
  }

  return history;
}

export async function getSettlementSummary(groupId) {
  const settlement = await calculateSettlement(groupId);
  const group = await get('SELECT currency FROM groups WHERE id = ?', [groupId]);
  const currency = group?.currency || 'EUR';

  let summary = `
    <h2>Settlement Summary</h2>
    <p><strong>Total Received:</strong> ${formatCurrency(settlement.totalReceived, currency)}</p>
    <p><strong>Total Expenses:</strong> ${formatCurrency(settlement.totalExpenses, currency)}</p>
    <p><strong>Net Profit:</strong> ${formatCurrency(settlement.netProfit, currency)}</p>
    <p><strong>Average Share:</strong> ${formatCurrency(settlement.perPersonShare, currency)}</p>
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
        <td>${formatCurrency(member.amountSpent, currency)}</td>
        <td>${formatCurrency(member.amountReceived, currency)}</td>
        <td>${formatCurrency(member.netAfterOwnActivity, currency)}</td>
        <td>${formatCurrency(member.profitShare, currency)}</td>
        <td>${status} ${formatCurrency(Math.abs(member.balance), currency)}</td>
      </tr>
    `;
  });

  if (settlement.transferSuggestions.length > 0) {
    summary += '<h3>Recommended settle-up payments:</h3><ul>';
    settlement.transferSuggestions.forEach((item) => {
      summary += `<li>${item.fromName} pays ${item.toName} ${formatCurrency(item.amount, currency)}</li>`;
    });
    summary += '</ul>';
  }

  summary += `</table>`;
  return summary;
}
