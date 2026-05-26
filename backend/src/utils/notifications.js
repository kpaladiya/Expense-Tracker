import { all, get } from '../db/index.js';
import { logGroupActivity } from './activity.js';
import { formatCurrency } from './currency.js';
import { getActivationBaseUrl, sendEmail } from './email.js';
import { createInboxNotifications } from './inbox.js';
import { calculateSettlement, getSettlementHistory } from './settlement.js';

function formatDate(value) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleDateString();
}

function formatMonth(value) {
  if (!value) {
    return 'this month';
  }

  const [year, month] = value.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  });
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  return new Date(value).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getGroupUrl(groupId) {
  const baseUrl = getActivationBaseUrl().replace(/\/$/, '');
  return `${baseUrl}/group/${groupId}`;
}

async function getGroupNotificationContext(groupId, actorUserId) {
  const [group, actor, members] = await Promise.all([
    get('SELECT id, name, currency FROM groups WHERE id = ?', [groupId]),
    actorUserId ? get('SELECT id, name, email FROM users WHERE id = ?', [actorUserId]) : Promise.resolve(null),
    all(
      `SELECT u.id, u.name, u.email
       FROM users u
       JOIN group_members gm ON gm.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY u.name`,
      [groupId]
    )
  ]);

  return {
    group,
    actor,
    members
  };
}

function buildDeliveryWarning(failedResults, recipientCount, actionLabel = 'Saved') {
  if (failedResults.length === 0) {
    return null;
  }

  const firstMessage = failedResults[0]?.reason?.message || 'Unknown email delivery error.';

  if (failedResults.length === recipientCount) {
    return `${actionLabel}, but email notifications could not be delivered. ${firstMessage}`;
  }

  return `${actionLabel}, but email notifications failed for ${failedResults.length} member${failedResults.length === 1 ? '' : 's'}. ${firstMessage}`;
}

async function sendNotifications(recipients, createMessage, options = {}) {
  if (recipients.length === 0) {
    return null;
  }

  const results = await Promise.allSettled(
    recipients.map((recipient) => sendEmail(createMessage(recipient)))
  );

  return buildDeliveryWarning(
    results.filter((result) => result.status === 'rejected'),
    recipients.length,
    options.actionLabel
  );
}

async function sendMemberNotifications(recipients, createNotification, createMessage, options = {}) {
  if (recipients.length === 0) {
    return null;
  }

  await createInboxNotifications(
    recipients.map((recipient) => createNotification(recipient))
  );

  return sendNotifications(recipients, createMessage, options);
}

function buildTransferSummary(settlement, currency) {
  if (!settlement?.transferSuggestions?.length) {
    return 'No additional member-to-member transfers are needed.';
  }

  return settlement.transferSuggestions
    .map((item) => `${item.fromName} pays ${item.toName} ${formatCurrency(item.amount, currency)}`)
    .join('\n');
}

function buildTableRows(items, createColumns) {
  if (items.length === 0) {
    return '<tr><td colspan="5" style="padding:10px;border:1px solid #d1d5db;color:#6b7280;">No records</td></tr>';
  }

  return items
    .map((item) => `<tr>${createColumns(item).join('')}</tr>`)
    .join('');
}

async function buildGroupDeletionReport(groupId) {
  const [group, members, expenses, payments, openSettlement, settlementHistory] = await Promise.all([
    get('SELECT id, name, description, currency, created_at FROM groups WHERE id = ?', [groupId]),
    all(
      `SELECT u.id, u.name, u.email
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY u.name`,
      [groupId]
    ),
    all(
      `SELECT e.amount, e.note, e.expense_date, u.name AS user_name
       FROM expenses e
       JOIN users u ON u.id = e.user_id
       WHERE e.group_id = ?
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      [groupId]
    ),
    all(
      `SELECT p.amount, p.payment_method, p.customer_note, p.payment_date, u.name AS user_name
       FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE p.group_id = ?
       ORDER BY p.payment_date DESC, p.created_at DESC`,
      [groupId]
    ),
    calculateSettlement(groupId, { excludeSettledMonths: true }),
    getSettlementHistory(groupId)
  ]);

  const currency = group?.currency || 'EUR';
  const memberList = members
    .map((member) => `<li><strong>${escapeHtml(member.name)}</strong> (${escapeHtml(member.email)})</li>`)
    .join('');
  const memberBalances = buildTableRows(openSettlement.memberBalances || [], (member) => [
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(member.name)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${formatCurrency(member.amountSpent, currency)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${formatCurrency(member.amountReceived, currency)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${formatCurrency(member.profitShare, currency)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${member.balance > 0 ? 'Gets' : member.balance < 0 ? 'Owes' : 'Even'} ${formatCurrency(Math.abs(member.balance), currency)}</td>`
  ]);
  const expenseRows = buildTableRows(expenses, (expense) => [
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(expense.user_name)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${formatCurrency(expense.amount, currency)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(expense.note || '-')}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(formatDate(expense.expense_date))}</td>`,
    '<td style="padding:10px;border:1px solid #d1d5db;">Expense</td>'
  ]);
  const paymentRows = buildTableRows(payments, (payment) => [
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(payment.user_name)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${formatCurrency(payment.amount, currency)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(payment.customer_note || '-')}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(formatDate(payment.payment_date))}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(payment.payment_method)}</td>`
  ]);
  const monthRows = buildTableRows(settlementHistory, (month) => [
    `<td style="padding:10px;border:1px solid #d1d5db;">${escapeHtml(formatMonth(month.month))}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${formatCurrency(month.totalReceived, currency)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${formatCurrency(month.totalExpenses, currency)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${formatCurrency(month.netProfit, currency)}</td>`,
    `<td style="padding:10px;border:1px solid #d1d5db;">${month.isSettled ? `Closed on ${escapeHtml(formatDateTime(month.settledAt))}` : 'Open'}</td>`
  ]);

  return {
    group,
    members,
    text: `Final report for ${group?.name || 'your group'}\n\nGroup currency: ${currency}\nMembers: ${members
      .map((member) => `${member.name} <${member.email}>`)
      .join(', ')}\nTotal received: ${formatCurrency(openSettlement.totalReceived, currency)}\nTotal expenses: ${formatCurrency(openSettlement.totalExpenses, currency)}\nNet profit: ${formatCurrency(openSettlement.netProfit, currency)}\nAverage share: ${formatCurrency(openSettlement.perPersonShare, currency)}\n\nExpenses recorded: ${expenses.length}\nPayments recorded: ${payments.length}\nMonthly settlements: ${settlementHistory.length}\n`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111827;">
        <h2>Final report for ${escapeHtml(group?.name || 'your group')}</h2>
        <p>This report was sent before the group is disabled.</p>
        <p><strong>Created:</strong> ${escapeHtml(formatDateTime(group?.created_at))}<br />
        <strong>Currency:</strong> ${escapeHtml(currency)}<br />
        <strong>Group URL:</strong> <a href="${getGroupUrl(groupId)}">${getGroupUrl(groupId)}</a></p>

        <h3>Members</h3>
        <ul>${memberList || '<li>No members</li>'}</ul>

        <h3>Open settlement summary</h3>
        <p><strong>Total received:</strong> ${formatCurrency(openSettlement.totalReceived, currency)}<br />
        <strong>Total expenses:</strong> ${formatCurrency(openSettlement.totalExpenses, currency)}<br />
        <strong>Net profit:</strong> ${formatCurrency(openSettlement.netProfit, currency)}<br />
        <strong>Average share:</strong> ${formatCurrency(openSettlement.perPersonShare, currency)}</p>

        <table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Member</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Spent</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Received</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Share</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Balance</th>
            </tr>
          </thead>
          <tbody>${memberBalances}</tbody>
        </table>

        <h3>Expenses</h3>
        <table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Member</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Amount</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Note</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Date</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Type</th>
            </tr>
          </thead>
          <tbody>${expenseRows}</tbody>
        </table>

        <h3>Payments</h3>
        <table style="border-collapse: collapse; width: 100%; margin-bottom: 24px;">
          <thead>
            <tr>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Member</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Amount</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Customer note</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Date</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Method</th>
            </tr>
          </thead>
          <tbody>${paymentRows}</tbody>
        </table>

        <h3>Monthly settlement history</h3>
        <table style="border-collapse: collapse; width: 100%;">
          <thead>
            <tr>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Month</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Received</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Expenses</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Net</th>
              <th style="padding:10px;border:1px solid #d1d5db;text-align:left;">Status</th>
            </tr>
          </thead>
          <tbody>${monthRows}</tbody>
        </table>
      </div>
    `
  };
}

export async function notifyExpenseAdded({ groupId, actorUserId, amount, note, expenseDate }) {
  const { group, actor, members } = await getGroupNotificationContext(groupId, actorUserId);
  const recipients = members.filter((member) => member.id !== actorUserId);
  const groupUrl = getGroupUrl(groupId);

  return sendMemberNotifications(
    recipients,
    (recipient) => ({
      userId: recipient.id,
      groupId,
      type: 'expense_added',
      title: `New expense in ${group?.name || 'your group'}`,
      message: `${actor?.name || 'A group member'} added ${formatCurrency(amount, group?.currency)} on ${formatDate(expenseDate)}.${note ? ` ${note}` : ''}`,
      actionUrl: `/group/${groupId}`,
      metadata: {
        amount,
        note,
        expenseDate
      }
    }),
    (recipient) => ({
    to: recipient.email,
    subject: `New expense added in ${group?.name || 'your group'}`,
    text: `Hi ${recipient.name},\n\n${actor?.name || 'A group member'} added a new expense in ${group?.name || 'your group'}.\n\nAmount: ${formatCurrency(amount, group?.currency)}\nDate: ${formatDate(expenseDate)}\nNote: ${note || 'No note'}\nOpen group: ${groupUrl}\n`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>New expense added</h2>
        <p>Hi ${recipient.name},</p>
        <p><strong>${actor?.name || 'A group member'}</strong> added a new expense in <strong>${group?.name || 'your group'}</strong>.</p>
        <p><strong>Amount:</strong> ${formatCurrency(amount, group?.currency)}<br />
        <strong>Date:</strong> ${formatDate(expenseDate)}<br />
        <strong>Note:</strong> ${note || 'No note'}</p>
        <p><a href="${groupUrl}">Open this group</a></p>
      </div>
    `
    }),
    { actionLabel: 'Saved' }
  );
}

export async function notifyPaymentAdded({ groupId, actorUserId, amount, paymentMethod, customerNote, paymentDate }) {
  const { group, actor, members } = await getGroupNotificationContext(groupId, actorUserId);
  const recipients = members.filter((member) => member.id !== actorUserId);
  const groupUrl = getGroupUrl(groupId);

  return sendMemberNotifications(
    recipients,
    (recipient) => ({
      userId: recipient.id,
      groupId,
      type: 'payment_added',
      title: `New payment in ${group?.name || 'your group'}`,
      message: `${actor?.name || 'A group member'} recorded ${formatCurrency(amount, group?.currency)} via ${paymentMethod} on ${formatDate(paymentDate)}.`,
      actionUrl: `/group/${groupId}`,
      metadata: {
        amount,
        paymentMethod,
        customerNote,
        paymentDate
      }
    }),
    (recipient) => ({
    to: recipient.email,
    subject: `New payment recorded in ${group?.name || 'your group'}`,
    text: `Hi ${recipient.name},\n\n${actor?.name || 'A group member'} recorded a payment in ${group?.name || 'your group'}.\n\nAmount: ${formatCurrency(amount, group?.currency)}\nMethod: ${paymentMethod}\nDate: ${formatDate(paymentDate)}\nCustomer note: ${customerNote || 'No note'}\nOpen group: ${groupUrl}\n`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>New payment recorded</h2>
        <p>Hi ${recipient.name},</p>
        <p><strong>${actor?.name || 'A group member'}</strong> recorded a payment in <strong>${group?.name || 'your group'}</strong>.</p>
        <p><strong>Amount:</strong> ${formatCurrency(amount, group?.currency)}<br />
        <strong>Method:</strong> ${paymentMethod}<br />
        <strong>Date:</strong> ${formatDate(paymentDate)}<br />
        <strong>Customer note:</strong> ${customerNote || 'No note'}</p>
        <p><a href="${groupUrl}">Open this group</a></p>
      </div>
    `
    }),
    { actionLabel: 'Saved' }
  );
}

export async function notifyMonthSettled({ groupId, actorUserId, month, settlement }) {
  const { group, actor, members } = await getGroupNotificationContext(groupId, actorUserId);
  const groupUrl = getGroupUrl(groupId);
  const transferSummary = buildTransferSummary(settlement, group?.currency);

  return sendMemberNotifications(
    members,
    (recipient) => ({
      userId: recipient.id,
      groupId,
      type: 'month_settled',
      title: `${formatMonth(month)} settled in ${group?.name || 'your group'}`,
      message: `${actor?.name || 'A group member'} settled ${formatMonth(month)}. ${settlement.transferSuggestions?.length || 0} recommended settle-up transfer(s) are ready.`,
      actionUrl: `/group/${groupId}`,
      metadata: {
        month
      }
    }),
    (recipient) => ({
    to: recipient.email,
    subject: `${formatMonth(month)} settled in ${group?.name || 'your group'}`,
    text: `Hi ${recipient.name},\n\n${actor?.name || 'A group member'} settled ${formatMonth(month)} for ${group?.name || 'your group'}.\n\nTotal received: ${formatCurrency(settlement.totalReceived, group?.currency)}\nTotal expenses: ${formatCurrency(settlement.totalExpenses, group?.currency)}\nNet profit: ${formatCurrency(settlement.netProfit, group?.currency)}\nAverage share: ${formatCurrency(settlement.perPersonShare, group?.currency)}\n\nRecommended settle-up transfers:\n${transferSummary}\n\nOpen group: ${groupUrl}\n`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Monthly settlement closed</h2>
        <p>Hi ${recipient.name},</p>
        <p><strong>${actor?.name || 'A group member'}</strong> settled <strong>${formatMonth(month)}</strong> for <strong>${group?.name || 'your group'}</strong>.</p>
        <p><strong>Total received:</strong> ${formatCurrency(settlement.totalReceived, group?.currency)}<br />
        <strong>Total expenses:</strong> ${formatCurrency(settlement.totalExpenses, group?.currency)}<br />
        <strong>Net profit:</strong> ${formatCurrency(settlement.netProfit, group?.currency)}<br />
        <strong>Average share:</strong> ${formatCurrency(settlement.perPersonShare, group?.currency)}</p>
        <p><strong>Recommended settle-up transfers:</strong><br />${escapeHtml(transferSummary).replace(/\n/g, '<br />')}</p>
        <p><a href="${groupUrl}">Open this group</a></p>
      </div>
    `
    }),
    { actionLabel: 'Month settled' }
  );
}

export async function notifyGroupDeletionRequested({ groupId, actorUserId }) {
  const { group, actor, members } = await getGroupNotificationContext(groupId, actorUserId);
  const groupUrl = getGroupUrl(groupId);

  return sendMemberNotifications(
    members,
    (recipient) => ({
      userId: recipient.id,
      groupId,
      type: 'group_disable_request',
      title: `Disable approval requested for ${group?.name || 'your group'}`,
      message: `${actor?.name || 'The group admin'} requested approval to disable this group.`,
      actionUrl: `/group/${groupId}`,
      metadata: {
        requestedByUserId: actorUserId
      }
    }),
    (recipient) => ({
    to: recipient.email,
    subject: `Group disable approval requested for ${group?.name || 'your group'}`,
    text: `Hi ${recipient.name},\n\n${actor?.name || 'The group admin'} requested approval to disable ${group?.name || 'your group'}.\n\nOpen the group and review the Approvals tab here:\n${groupUrl}\n`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <h2>Group disable approval requested</h2>
        <p>Hi ${escapeHtml(recipient.name)},</p>
        <p><strong>${escapeHtml(actor?.name || 'The group admin')}</strong> requested approval to disable <strong>${escapeHtml(group?.name || 'your group')}</strong>.</p>
        <p>Please open the <strong>Approvals</strong> tab in the group and review it:</p>
        <p><a href="${groupUrl}">${groupUrl}</a></p>
      </div>
    `
    }),
    { actionLabel: 'Disable request created' }
  );
}

export async function sendGroupDeletionReport({ groupId }) {
  const report = await buildGroupDeletionReport(groupId);
  const groupUrl = getGroupUrl(groupId);

  return sendMemberNotifications(
    report.members,
    (recipient) => ({
      userId: recipient.id,
      groupId,
      type: 'group_disabled',
      title: `Final report for ${report.group?.name || 'your group'}`,
      message: `The group is being disabled. Final summary and export details are ready.`,
      actionUrl: `/group/${groupId}`,
      metadata: {
        groupUrl
      }
    }),
    (recipient) => ({
    to: recipient.email,
    subject: `Final report for ${report.group?.name || 'your group'}`,
    text: `Hi ${recipient.name},\n\nThis is the final report for ${report.group?.name || 'your group'} before it is disabled.\n\n${report.text}`,
    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.5;">
        <p>Hi ${escapeHtml(recipient.name)},</p>
        <p>This is the final report for <strong>${escapeHtml(report.group?.name || 'your group')}</strong> before it is disabled.</p>
        ${report.html}
      </div>
    `
    }),
    { actionLabel: 'Group disabled' }
  );
}
