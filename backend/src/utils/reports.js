import PDFDocument from 'pdfkit';
import { all, get } from '../db/index.js';
import { formatCurrency } from './currency.js';
import { calculateSettlement, getSettlementHistory, normalizeMonth } from './settlement.js';

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '-';
}

function formatMonthLabel(month) {
  if (!month) {
    return 'All time';
  }

  const [year, monthNumber] = month.split('-');
  return new Date(Number(year), Number(monthNumber) - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  });
}

async function getGroup(groupId) {
  return get('SELECT id, name, description, currency FROM groups WHERE id = ?', [groupId]);
}

async function getExpensesForMonth(groupId, month) {
  return all(
    `SELECT e.id, e.amount, e.note, e.expense_date, u.name AS user_name
     FROM expenses e
     JOIN users u ON u.id = e.user_id
     WHERE e.group_id = ?
       AND substr(e.expense_date, 1, 7) = ?
     ORDER BY e.expense_date DESC, e.created_at DESC`,
    [groupId, month]
  );
}

async function getPaymentsForMonth(groupId, month) {
  return all(
    `SELECT p.id, p.amount, p.payment_method, p.customer_note, p.payment_date, u.name AS user_name
     FROM payments p
     JOIN users u ON u.id = p.user_id
     WHERE p.group_id = ?
       AND substr(p.payment_date, 1, 7) = ?
     ORDER BY p.payment_date DESC, p.created_at DESC`,
    [groupId, month]
  );
}

export async function getResolvedMonth(groupId, month) {
  const normalizedMonth = normalizeMonth(month);

  if (normalizedMonth) {
    return normalizedMonth;
  }

  const history = await getSettlementHistory(groupId);

  if (history.length > 0) {
    return history[0].month;
  }

  return new Date().toISOString().slice(0, 7);
}

export async function buildMonthlySummary(groupId, requestedMonth = null) {
  const group = await getGroup(groupId);
  const month = await getResolvedMonth(groupId, requestedMonth);
  const [summary, history, expenses, payments] = await Promise.all([
    calculateSettlement(groupId, { month }),
    getSettlementHistory(groupId),
    getExpensesForMonth(groupId, month),
    getPaymentsForMonth(groupId, month)
  ]);

  const settledMonth = history.find((item) => item.month === month);
  const currency = group?.currency || 'EUR';

  return {
    group,
    month,
    monthLabel: formatMonthLabel(month),
    currency,
    isSettled: Boolean(settledMonth?.isSettled),
    settledAt: settledMonth?.settledAt || null,
    settledByName: settledMonth?.settledByName || null,
    totals: {
      totalReceived: summary.totalReceived,
      totalExpenses: summary.totalExpenses,
      netProfit: summary.netProfit,
      perPersonShare: summary.perPersonShare
    },
    memberBalances: summary.memberBalances,
    transferSuggestions: summary.transferSuggestions || [],
    records: {
      expenses,
      payments,
      expenseCount: expenses.length,
      paymentCount: payments.length
    },
    availableMonths: history.map((item) => ({
      month: item.month,
      label: formatMonthLabel(item.month),
      isSettled: item.isSettled
    }))
  };
}

export function buildMonthlySummaryCsv(summary) {
  const { currency } = summary;
  const lines = [
    ['Section', 'Label', 'Value'],
    ['Summary', 'Month', summary.monthLabel],
    ['Summary', 'Currency', currency],
    ['Summary', 'Total received', summary.totals.totalReceived],
    ['Summary', 'Total expenses', summary.totals.totalExpenses],
    ['Summary', 'Net profit', summary.totals.netProfit],
    ['Summary', 'Per person share', summary.totals.perPersonShare],
    ['Summary', 'Status', summary.isSettled ? 'Settled' : 'Open'],
    []
  ];

  lines.push(['Members', 'Name', 'Spent', 'Received', 'Share', 'Balance']);
  summary.memberBalances.forEach((member) => {
    lines.push([
      'Members',
      member.name,
      member.amountSpent,
      member.amountReceived,
      member.profitShare,
      member.balance
    ]);
  });
  lines.push([]);
  lines.push(['Transfers', 'From', 'To', 'Amount']);
  summary.transferSuggestions.forEach((item) => {
    lines.push(['Transfers', item.fromName, item.toName, item.amount]);
  });
  lines.push([]);
  lines.push(['Expenses', 'Member', 'Amount', 'Date', 'Note']);
  summary.records.expenses.forEach((expense) => {
    lines.push(['Expenses', expense.user_name, expense.amount, expense.expense_date, expense.note || '']);
  });
  lines.push([]);
  lines.push(['Payments', 'Member', 'Amount', 'Date', 'Method', 'Note']);
  summary.records.payments.forEach((payment) => {
    lines.push([
      'Payments',
      payment.user_name,
      payment.amount,
      payment.payment_date,
      payment.payment_method,
      payment.customer_note || ''
    ]);
  });

  return lines
    .map((row) =>
      row
        .map((value) => {
          const stringValue = String(value ?? '');
          return stringValue.includes(',') || stringValue.includes('"')
            ? `"${stringValue.replace(/"/g, '""')}"`
            : stringValue;
        })
        .join(',')
    )
    .join('\n');
}

export function buildMonthlySummaryPdf(summary) {
  return new Promise((resolve) => {
    const document = new PDFDocument({ margin: 40 });
    const chunks = [];

    document.on('data', (chunk) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));

    document.fontSize(18).text(`${summary.group?.name || 'Group'} Monthly Summary`, { underline: true });
    document.moveDown(0.5);
    document.fontSize(11).text(`Month: ${summary.monthLabel}`);
    document.text(`Currency: ${summary.currency}`);
    document.text(`Status: ${summary.isSettled ? 'Settled' : 'Open'}`);
    if (summary.settledAt) {
      document.text(`Settled at: ${formatDate(summary.settledAt)} by ${summary.settledByName || '-'}`);
    }

    document.moveDown();
    document.fontSize(13).text('Totals');
    document.fontSize(11).text(`Received: ${formatCurrency(summary.totals.totalReceived, summary.currency)}`);
    document.text(`Expenses: ${formatCurrency(summary.totals.totalExpenses, summary.currency)}`);
    document.text(`Net profit: ${formatCurrency(summary.totals.netProfit, summary.currency)}`);
    document.text(`Per person share: ${formatCurrency(summary.totals.perPersonShare, summary.currency)}`);

    document.moveDown();
    document.fontSize(13).text('Recommended settle-up');
    document.fontSize(11);
    if (summary.transferSuggestions.length === 0) {
      document.text('No additional member-to-member transfers are needed.');
    } else {
      summary.transferSuggestions.forEach((item) => {
        document.text(`- ${item.fromName} pays ${item.toName} ${formatCurrency(item.amount, summary.currency)}`);
      });
    }

    document.moveDown();
    document.fontSize(13).text('Member balances');
    document.fontSize(11);
    summary.memberBalances.forEach((member) => {
      document.text(
        `${member.name}: spent ${formatCurrency(member.amountSpent, summary.currency)}, received ${formatCurrency(member.amountReceived, summary.currency)}, balance ${formatCurrency(member.balance, summary.currency)}`
      );
    });

    document.moveDown();
    document.fontSize(13).text('Expenses');
    document.fontSize(11);
    if (summary.records.expenses.length === 0) {
      document.text('No expenses recorded.');
    } else {
      summary.records.expenses.forEach((expense) => {
        document.text(`- ${expense.user_name}: ${formatCurrency(expense.amount, summary.currency)} on ${formatDate(expense.expense_date)}${expense.note ? ` (${expense.note})` : ''}`);
      });
    }

    document.moveDown();
    document.fontSize(13).text('Payments');
    document.fontSize(11);
    if (summary.records.payments.length === 0) {
      document.text('No payments recorded.');
    } else {
      summary.records.payments.forEach((payment) => {
        document.text(`- ${payment.user_name}: ${formatCurrency(payment.amount, summary.currency)} on ${formatDate(payment.payment_date)} via ${payment.payment_method}${payment.customer_note ? ` (${payment.customer_note})` : ''}`);
      });
    }

    document.end();
  });
}
