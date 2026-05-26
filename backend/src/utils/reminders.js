import { all } from '../db/index.js';
import { createInboxNotifications } from './inbox.js';

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentMonth() {
  return getToday().slice(0, 7);
}

function getWeekKey(date) {
  const current = new Date(date);
  current.setUTCHours(0, 0, 0, 0);
  current.setUTCDate(current.getUTCDate() + 4 - (current.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((current - yearStart) / 86400000) + 1) / 7);
  return `${current.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function isTemplateDue(template, today) {
  const now = new Date(`${today}T00:00:00Z`);
  const lastUsedDate = template.last_used_at ? String(template.last_used_at).slice(0, 10) : null;

  if (template.frequency === 'monthly') {
    const dueDay = Number(template.day_of_month || 1);
    return now.getUTCDate() >= dueDay && (!lastUsedDate || !lastUsedDate.startsWith(today.slice(0, 7)));
  }

  const dueWeekday = Number(template.day_of_week || 0);
  const todayWeekday = now.getUTCDay();
  return todayWeekday === dueWeekday && lastUsedDate !== today;
}

export async function ensureUserReminders(userId) {
  const today = getToday();
  const currentMonth = getCurrentMonth();
  const weekKey = getWeekKey(today);
  const entries = [];

  const [pendingApprovals, openMonths, templates] = await Promise.all([
    all(
      `SELECT gdr.id, gdr.group_id, g.name AS group_name
       FROM group_delete_approvals gda
       JOIN group_delete_requests gdr ON gdr.id = gda.request_id
       JOIN groups g ON g.id = gdr.group_id
       WHERE gda.user_id = ?
         AND gda.approved_at IS NULL
         AND g.is_disabled = 0`,
      [userId]
    ),
    all(
      `SELECT g.id AS group_id, g.name AS group_name, substr(p.payment_date, 1, 7) AS month,
              SUM(p.amount) AS total_received
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       JOIN payments p ON p.group_id = g.id
       LEFT JOIN settled_months sm
         ON sm.group_id = g.id
        AND sm.month = substr(p.payment_date, 1, 7)
       WHERE gm.user_id = ?
         AND g.is_disabled = 0
         AND sm.id IS NULL
       GROUP BY g.id, g.name, substr(p.payment_date, 1, 7)
       HAVING SUM(p.amount) > 0`,
      [userId]
    ),
    all(
      `SELECT rt.id, rt.group_id, rt.title, rt.entry_type, rt.frequency, rt.day_of_week, rt.day_of_month,
              rt.last_used_at, g.name AS group_name
       FROM recurring_templates rt
       JOIN groups g ON g.id = rt.group_id
       WHERE rt.user_id = ?
         AND rt.is_active = 1
         AND g.is_disabled = 0`,
      [userId]
    )
  ]);

  pendingApprovals.forEach((item) => {
    entries.push({
      userId,
      groupId: item.group_id,
      type: 'reminder',
      title: `Approval still needed in ${item.group_name}`,
      message: 'A group disable request is still waiting for your response.',
      actionUrl: `/group/${item.group_id}`,
      dedupeKey: `reminder-approval:${today}:${item.id}`
    });
  });

  openMonths
    .filter((item) => item.month <= currentMonth)
    .forEach((item) => {
      entries.push({
        userId,
        groupId: item.group_id,
        type: 'reminder',
        title: `Settle-up reminder for ${item.group_name}`,
        message: `${item.month} has received money but is still open. Review the monthly summary and settle when ready.`,
        actionUrl: `/group/${item.group_id}`,
        dedupeKey: `reminder-settlement:${weekKey}:${item.group_id}:${item.month}`
      });
    });

  templates
    .filter((template) => isTemplateDue(template, today))
    .forEach((template) => {
      entries.push({
        userId,
        groupId: template.group_id,
        type: 'reminder',
        title: `Recurring ${template.entry_type} due in ${template.group_name}`,
        message: `Your template "${template.title}" is due today.`,
        actionUrl: `/group/${template.group_id}`,
        dedupeKey: `reminder-template:${today}:${template.id}`
      });
    });

  await createInboxNotifications(entries);
}
