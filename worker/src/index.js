const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const PBKDF2_ITERATIONS = 310_000;
const encoder = new TextEncoder();

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extra }
  });
const ok = (data, message, status = 200) => json({ success: true, ...(message ? { message } : {}), ...(data !== undefined ? { data } : {}) }, status);
const fail = (error, status = 400) => json({ success: false, error }, status);
const id = () => crypto.randomUUID();
const nowSeconds = () => Math.floor(Date.now() / 1000);
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')), char => char.charCodeAt(0));
const encode = value => b64url(encoder.encode(JSON.stringify(value)));
const decode = value => JSON.parse(new TextDecoder().decode(unb64url(value)));
function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function cors(request, env) {
  const origin = request.headers.get('origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const accessOrigin = !origin ? '*' : (!allowed.length || allowed.includes(origin) ? origin : '');
  return {
    'access-control-allow-origin': accessOrigin,
    'access-control-allow-headers': 'Authorization, Content-Type',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'vary': 'Origin'
  };
}
function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  Object.entries(cors(request, env)).forEach(([key, value]) => value && headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}
async function makeToken(user, env) {
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ sub: user.id, email: user.email, name: user.name, iat: nowSeconds(), exp: nowSeconds() + TOKEN_TTL_SECONDS, jti: id() });
  return `${header}.${payload}.${b64url(await hmac(`${header}.${payload}`, env.JWT_SECRET))}`;
}
async function readToken(request, env, optional = false) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !env.JWT_SECRET) return optional ? null : null;
  const [header, body, signature, ...extra] = token.split('.');
  if (!header || !body || !signature || extra.length) return null;
  const expected = await hmac(`${header}.${body}`, env.JWT_SECRET);
  const supplied = unb64url(signature);
  if (!constantTimeEqual(expected, supplied)) return null;
  try {
    const claims = decode(body);
    return claims.exp > nowSeconds() && typeof claims.sub === 'string' && typeof claims.jti === 'string' ? claims : null;
  } catch { return null; }
}
async function auth(request, env) {
  if (!env.JWT_SECRET) return { error: fail('JWT_SECRET is not configured', 500) };
  const claims = await readToken(request, env);
  if (!claims) return { error: fail('Authentication required', 401) };
  const revoked = await env.DB.prepare('SELECT 1 FROM token_revocations WHERE jti = ?').bind(claims.jti).first();
  if (revoked) return { error: fail('Token has been revoked', 401) };
  const user = await env.DB.prepare('SELECT id, email, name, is_admin, onboarding_completed, onboarding_seen_at, created_at FROM users WHERE id = ?').bind(claims.sub).first();
  return user ? { user, claims } : { error: fail('User not found', 401) };
}
async function body(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('multipart/form-data')) {
    const data = await request.formData();
    const attachment = data.get('attachment');
    if (attachment instanceof File && attachment.size) throw new ApiError('Attachments are not supported by this free-tier Worker', 501);
    return Object.fromEntries([...data].filter(([, value]) => typeof value === 'string'));
  }
  if (!type.includes('application/json')) return {};
  try { return await request.json(); } catch { throw new ApiError('Request body must be valid JSON', 400); }
}
class ApiError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const required = (value, name) => { if (!String(value || '').trim()) throw new ApiError(`${name} is required`); return String(value).trim(); };
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '').slice(0, 7)) ? String(value).slice(0, 7) : null;
async function all(db, sql, ...params) { return (await db.prepare(sql).bind(...params).all()).results; }
async function first(db, sql, ...params) { return db.prepare(sql).bind(...params).first(); }
async function run(db, sql, ...params) { return db.prepare(sql).bind(...params).run(); }
async function member(db, groupId, userId) { return first(db, 'SELECT id, role FROM group_members WHERE group_id = ? AND user_id = ?', groupId, userId); }
async function group(db, groupId) { return first(db, 'SELECT * FROM groups WHERE id = ?', groupId); }
async function ensureMember(db, groupId, userId) {
  const membership = await member(db, groupId, userId);
  if (!membership) throw new ApiError('User is not a member of this group', 403);
  return membership;
}
async function ensureActive(db, groupId) {
  const value = await group(db, groupId);
  if (!value) throw new ApiError('Group not found', 404);
  if (value.is_disabled) throw new ApiError('This group has been disabled and is now read-only', 409);
  return value;
}
async function ensureManager(db, groupId, userId, membersOnly = false) {
  const [g, membership] = await Promise.all([group(db, groupId), member(db, groupId, userId)]);
  if (!g) throw new ApiError('Group not found', 404);
  if (!membership) throw new ApiError('User is not a member of this group', 403);
  const roles = membersOnly ? ['co_admin'] : ['co_admin', 'manager'];
  if (g.admin_id !== userId && !roles.includes(membership.role)) throw new ApiError('You do not have permission to manage this action', 403);
  return g;
}
async function log(db, groupId, userId, type, title, description, entityType = null, entityId = null, metadata = null) {
  await run(db, `INSERT INTO activity_logs (id, group_id, user_id, activity_type, entity_type, entity_id, title, description, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id(), groupId, userId, type, entityType, entityId, title, description, metadata ? JSON.stringify(metadata) : null);
}
async function notify(db, userId, groupId, type, title, message, actionUrl, dedupeKey = null) {
  const stmt = `INSERT INTO inbox_notifications (id, user_id, group_id, type, title, message, action_url, dedupe_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`;
  await run(db, stmt, id(), userId, groupId, type, title, message, actionUrl, dedupeKey);
}
function publicUser(user) {
  const onboardingCompleted = Boolean(user.onboarding_completed);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    googleLinked: false,
    is_admin: Boolean(user.is_admin),
    onboarding_completed: onboardingCompleted,
    onboarding_seen_at: user.onboarding_seen_at,
    onboardingCompleted,
    onboardingSeenAt: user.onboarding_seen_at
  };
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, key, 256);
  return b64url(new Uint8Array(bytes));
}
async function authRegister(request, env) {
  const { email: rawEmail, password, name: rawName } = await body(request);
  const email = required(rawEmail, 'Email').toLowerCase();
  const name = required(rawName, 'Name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('A valid email is required');
  if (typeof password !== 'string' || password.length < 8) throw new ApiError('Password must be at least 8 characters');
  if (await first(env.DB, 'SELECT id FROM users WHERE email = ?', email)) throw new ApiError('An account with this email already exists', 409);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const user = { id: id(), email, name };
  await run(env.DB, 'INSERT INTO users (id, email, name, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)', user.id, email, name, b64url(salt), await hashPassword(password, salt));
  return ok({ ...publicUser(user), token: await makeToken(user, env) }, 'Account created successfully', 201);
}
async function authLogin(request, env) {
  const { email: rawEmail, password } = await body(request);
  const email = required(rawEmail, 'Email').toLowerCase();
  const user = await first(env.DB, 'SELECT * FROM users WHERE email = ?', email);
  if (!user || typeof password !== 'string') throw new ApiError('Invalid email or password', 401);
  const expected = unb64url(user.password_hash), actual = unb64url(await hashPassword(password, unb64url(user.password_salt)));
  if (!constantTimeEqual(expected, actual)) throw new ApiError('Invalid email or password', 401);
  return ok({ ...publicUser(user), token: await makeToken(user, env) }, 'Login successful');
}
async function updateProfile(request, env, user) {
  const data = await body(request), name = data.name === undefined ? user.name : required(data.name, 'Name');
  const email = data.email === undefined ? user.email : required(data.email, 'Email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError('A valid email is required');
  if (data.password !== undefined && (typeof data.password !== 'string' || data.password.length < 8)) throw new ApiError('Password must be at least 8 characters');
  const duplicate = await first(env.DB, 'SELECT id FROM users WHERE email = ? AND id != ?', email, user.id);
  if (duplicate) throw new ApiError('An account with this email already exists', 409);
  const onboardingCompleted = data.onboardingCompleted === undefined ? user.onboarding_completed : Number(Boolean(data.onboardingCompleted));
  if (data.password !== undefined) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await run(env.DB, 'UPDATE users SET name = ?, email = ?, password_salt = ?, password_hash = ?, onboarding_completed = ?, onboarding_seen_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE onboarding_seen_at END WHERE id = ?', name, email, b64url(salt), await hashPassword(data.password, salt), onboardingCompleted, onboardingCompleted, user.id);
  } else {
    await run(env.DB, 'UPDATE users SET name = ?, email = ?, onboarding_completed = ?, onboarding_seen_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE onboarding_seen_at END WHERE id = ?', name, email, onboardingCompleted, onboardingCompleted, user.id);
  }
  const next = { ...user, name, email, onboarding_completed: onboardingCompleted };
  return ok({ ...publicUser(next), token: await makeToken(next, env) }, 'Profile updated successfully');
}

async function settlement(db, groupId, month = null, excludeSettled = false) {
  const members = await all(db, `SELECT u.id, u.name, u.email FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.name`, groupId);
  const condition = month ? ' AND substr(expense_date, 1, 7) = ?' : '';
  const conditionP = month ? ' AND substr(payment_date, 1, 7) = ?' : '';
  const args = month ? [groupId, month] : [groupId];
  const expenses = await all(db, `SELECT user_id, amount, expense_date FROM expenses WHERE group_id = ?${condition}`, ...args);
  const payments = await all(db, `SELECT user_id, amount, payment_date FROM payments WHERE group_id = ?${conditionP}`, ...args);
  const settled = excludeSettled ? new Set((await all(db, 'SELECT month FROM settled_months WHERE group_id = ?', groupId)).map(x => x.month)) : new Set();
  const usableExpenses = expenses.filter(x => !settled.has(x.expense_date.slice(0, 7)));
  const usablePayments = payments.filter(x => !settled.has(x.payment_date.slice(0, 7)));
  const totalExpenses = money(usableExpenses.reduce((sum, x) => sum + x.amount, 0));
  const totalReceived = money(usablePayments.reduce((sum, x) => sum + x.amount, 0));
  const netProfit = money(totalReceived - totalExpenses);
  const perPersonShare = members.length ? money(netProfit / members.length) : 0;
  const memberBalances = members.map(person => {
    const amountReceived = money(usablePayments.filter(x => x.user_id === person.id).reduce((sum, x) => sum + x.amount, 0));
    const amountSpent = money(usableExpenses.filter(x => x.user_id === person.id).reduce((sum, x) => sum + x.amount, 0));
    const netAfterOwnActivity = money(amountReceived - amountSpent);
    return {
      ...person,
      amountSpent,
      amountReceived,
      netAfterOwnActivity,
      profitShare: perPersonShare,
      balance: money(perPersonShare - netAfterOwnActivity)
    };
  });
  const creditors = memberBalances.filter(x => x.balance > 0.004).map(x => ({ ...x }));
  const debtors = memberBalances.filter(x => x.balance < -0.004).map(x => ({ ...x, balance: -x.balance }));
  const transferSuggestions = [];
  for (const debtor of debtors) for (const creditor of creditors) {
    const amount = money(Math.min(debtor.balance, creditor.balance));
    if (amount > 0) { transferSuggestions.push({ fromUserId: debtor.id, fromName: debtor.name, toUserId: creditor.id, toName: creditor.name, amount }); debtor.balance = money(debtor.balance - amount); creditor.balance = money(creditor.balance - amount); }
  }
  return { totalReceived, totalExpenses, netProfit, perPersonShare, numberOfMembers: members.length, memberBalances, transferSuggestions };
}
function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
async function report(db, groupId, month) {
  const selectedMonth = validMonth(month) || new Date().toISOString().slice(0, 7);
  const [g, calculated, expenses, payments] = await Promise.all([
    group(db, groupId), settlement(db, groupId, selectedMonth),
    all(db, `SELECT e.*, u.name user_name FROM expenses e JOIN users u ON u.id = e.user_id WHERE e.group_id = ? AND substr(e.expense_date,1,7) = ? ORDER BY e.expense_date`, groupId, selectedMonth),
    all(db, `SELECT p.*, u.name user_name FROM payments p JOIN users u ON u.id = p.user_id WHERE p.group_id = ? AND substr(p.payment_date,1,7) = ? ORDER BY p.payment_date`, groupId, selectedMonth)
  ]);
  const settled = await first(db, `SELECT s.settled_at, u.name settled_by_name FROM settled_months s JOIN users u ON u.id = s.settled_by_user_id WHERE s.group_id = ? AND s.month = ?`, groupId, selectedMonth);
  const availableMonths = await settlementHistoryRows(db, groupId);
  return {
    group: g,
    month: selectedMonth,
    monthLabel: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedMonth}-01T00:00:00Z`)),
    currency: g.currency,
    isSettled: Boolean(settled),
    settledAt: settled?.settled_at || null,
    settledByName: settled?.settled_by_name || null,
    totals: {
      totalReceived: calculated.totalReceived,
      totalExpenses: calculated.totalExpenses,
      netProfit: calculated.netProfit,
      perPersonShare: calculated.perPersonShare
    },
    memberBalances: calculated.memberBalances,
    transferSuggestions: calculated.transferSuggestions,
    records: { expenses, payments, expenseCount: expenses.length, paymentCount: payments.length },
    availableMonths: availableMonths.map(item => ({ month: item.month, label: new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${item.month}-01T00:00:00Z`)), isSettled: item.isSettled }))
  };
}

async function createGroup(request, env, user) {
  const data = await body(request), name = required(data.name, 'Group name'), currency = String(data.currency || 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError('A valid currency code is required');
  const groupId = id();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO groups (id, name, description, currency, admin_id) VALUES (?, ?, ?, ?, ?)').bind(groupId, name, String(data.description || '').trim(), currency, user.id),
    env.DB.prepare('INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, ?)').bind(id(), groupId, user.id, 'admin'),
    env.DB.prepare('INSERT INTO group_membership_periods (id, group_id, user_id, created_by_user_id) VALUES (?, ?, ?, ?)').bind(id(), groupId, user.id, user.id)
  ]);
  await log(env.DB, groupId, user.id, 'group_created', 'Group created', `Created group "${name}"`, 'group', groupId);
  return ok({ id: groupId, name, description: String(data.description || '').trim(), currency, adminId: user.id }, 'Group created successfully', 201);
}
async function listGroups(env, user) {
  return ok(await all(env.DB, `SELECT g.*, gm.role AS current_user_role, owner.name AS admin_name,
    (SELECT COUNT(*) FROM group_members countable WHERE countable.group_id = g.id) AS member_count
    FROM groups g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ? JOIN users owner ON owner.id = g.admin_id ORDER BY g.created_at DESC`, user.id));
}
async function groupDetail(env, user, groupId) {
  await ensureMember(env.DB, groupId, user.id);
  const [g, members, deletion] = await Promise.all([
    first(env.DB, `SELECT g.*, u.name admin_name, mine.role current_user_role FROM groups g JOIN users u ON u.id = g.admin_id JOIN group_members mine ON mine.group_id = g.id AND mine.user_id = ? WHERE g.id = ?`, user.id, groupId),
    all(env.DB, 'SELECT u.id, u.name, u.email, gm.role, gm.joined_at FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.name', groupId),
    first(env.DB, `SELECT r.id, r.group_id, r.requested_by_user_id, r.requested_at, requester.name requested_by_name,
      (SELECT COUNT(*) FROM group_delete_approvals a WHERE a.request_id = r.id AND a.approved_at IS NOT NULL) approvedCount,
      (SELECT COUNT(*) FROM group_delete_approvals a WHERE a.request_id = r.id) totalApprovals,
      EXISTS(SELECT 1 FROM group_delete_approvals a WHERE a.request_id = r.id AND a.user_id = ? AND a.approved_at IS NOT NULL) isApprovedByCurrentUser
      FROM group_delete_requests r JOIN users requester ON requester.id = r.requested_by_user_id WHERE r.group_id = ?`, user.id, groupId)
  ]);
  const approvals = deletion ? await all(env.DB, `SELECT a.user_id, a.approved_at, u.name, u.email FROM group_delete_approvals a JOIN users u ON u.id = a.user_id WHERE a.request_id = ? ORDER BY u.name`, deletion.id) : [];
  return ok({
    ...g,
    currentUserRole: g.current_user_role,
    members,
    deletionRequest: deletion ? { ...deletion, approvedCount: Number(deletion.approvedCount), totalApprovals: Number(deletion.totalApprovals), isApprovedByCurrentUser: Boolean(deletion.isApprovedByCurrentUser), approvals } : null
  });
}

async function updateGroup(request, env, user, groupId) {
  const membership = await ensureMember(env.DB, groupId, user.id);
  const existing = await ensureActive(env.DB, groupId);
  if (existing.admin_id !== user.id && membership.role !== 'co_admin') throw new ApiError('You do not have permission to update this group', 403);
  const data = await body(request), name = data.name === undefined ? existing.name : required(data.name, 'Group name');
  const currency = data.currency === undefined ? existing.currency : String(data.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError('A valid currency code is required');
  const description = data.description === undefined ? existing.description : String(data.description || '').trim();
  await run(env.DB, 'UPDATE groups SET name = ?, description = ?, currency = ? WHERE id = ?', name, description, currency, groupId);
  await log(env.DB, groupId, user.id, 'group_updated', 'Group updated', `Updated group "${name}"`, 'group', groupId);
  return ok({ id: groupId, name, description, currency }, 'Group updated successfully');
}
async function inviteMember(request, env, user, groupId) {
  const g = await ensureManager(env.DB, groupId, user.id);
  if (g.is_disabled) throw new ApiError('This group has been disabled and is now read-only', 409);
  const email = required((await body(request)).email, 'Email').toLowerCase();
  const invited = await first(env.DB, 'SELECT id, name FROM users WHERE email = ?', email);
  if (!invited) throw new ApiError('No account exists for this email. They must register before they can be invited.', 404);
  if (await member(env.DB, groupId, invited.id)) throw new ApiError('This user is already a member of this group', 409);
  const open = await first(env.DB, `SELECT id FROM group_join_requests WHERE group_id = ? AND invited_user_id = ? AND status IN ('pending_user', 'pending_admin')`, groupId, invited.id);
  if (open) throw new ApiError('This user already has a pending invitation', 409);
  const requestId = id();
  await run(env.DB, `INSERT INTO group_join_requests (id, group_id, invited_user_id, invited_by_user_id, status) VALUES (?, ?, ?, ?, 'pending_user')`, requestId, groupId, invited.id, user.id);
  await notify(env.DB, invited.id, groupId, 'group_invitation', 'You were invited to a group', `${user.name} invited you to join ${g.name}`, '/');
  await log(env.DB, groupId, user.id, 'member_invited', 'Member invited', `Invited ${invited.name}`, 'join_request', requestId);
  return ok({ id: requestId }, 'Invitation sent successfully', 201);
}
async function invitations(env, user) {
  return ok(await all(env.DB, `SELECT r.id, r.group_id, r.status, r.created_at, r.responded_at, g.is_disabled, g.name group_name, u.name invited_by_name, u.email invited_by_email
    FROM group_join_requests r JOIN groups g ON g.id = r.group_id JOIN users u ON u.id = r.invited_by_user_id
    WHERE r.invited_user_id = ? AND r.status IN ('pending_user', 'pending_admin') ORDER BY r.created_at DESC`, user.id));
}
async function respondInvitation(request, env, user, requestId) {
  const action = (await body(request)).action;
  if (!['accept', 'decline'].includes(action)) throw new ApiError('Action must be accept or decline');
  const invitation = await first(env.DB, `SELECT r.*, g.name group_name, g.is_disabled FROM group_join_requests r JOIN groups g ON g.id = r.group_id WHERE r.id = ? AND r.invited_user_id = ?`, requestId, user.id);
  if (!invitation) throw new ApiError('Join request not found', 404);
  if (invitation.status !== 'pending_user') throw new ApiError('This join request has already been handled', 409);
  if (invitation.is_disabled) throw new ApiError('This group has been disabled and is now read-only', 409);
  await run(env.DB, 'UPDATE group_join_requests SET status = ?, responded_at = CURRENT_TIMESTAMP WHERE id = ?', action === 'accept' ? 'pending_admin' : 'declined_by_user', requestId);
  if (action === 'accept') {
    const admins = await all(env.DB, `SELECT user_id FROM group_members WHERE group_id = ? AND role IN ('admin', 'co_admin')`, invitation.group_id);
    await Promise.all(admins.map(row => notify(env.DB, row.user_id, invitation.group_id, 'membership_approval', 'Membership approval needed', `${user.name} accepted the invitation to ${invitation.group_name}`, `/group/${invitation.group_id}`)));
  }
  return ok(undefined, action === 'accept' ? 'Join request accepted. Waiting for admin approval.' : 'Join request declined');
}
async function reviewInvitation(request, env, user, groupId, requestId) {
  const g = await ensureManager(env.DB, groupId, user.id, true);
  if (g.is_disabled) throw new ApiError('This group has been disabled and is now read-only', 409);
  const action = (await body(request)).action;
  if (!['approve', 'reject'].includes(action)) throw new ApiError('Action must be approve or reject');
  const invitation = await first(env.DB, `SELECT * FROM group_join_requests WHERE id = ? AND group_id = ? AND status = 'pending_admin'`, requestId, groupId);
  if (!invitation) throw new ApiError('Member request not found or already handled', 404);
  if (action === 'approve') {
    await env.DB.batch([
      env.DB.prepare(`UPDATE group_join_requests SET status = 'approved', responded_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(requestId),
      env.DB.prepare(`INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, 'member')`).bind(id(), groupId, invitation.invited_user_id),
      env.DB.prepare('INSERT INTO group_membership_periods (id, group_id, user_id, created_by_user_id) VALUES (?, ?, ?, ?)').bind(id(), groupId, invitation.invited_user_id, user.id)
    ]);
    await notify(env.DB, invitation.invited_user_id, groupId, 'membership_approved', 'You joined a group', `Your request to join ${g.name} was approved`, `/group/${groupId}`);
    await log(env.DB, groupId, user.id, 'member_added', 'Member added', 'Approved a group membership request', 'user', invitation.invited_user_id);
  } else {
    await run(env.DB, `UPDATE group_join_requests SET status = 'rejected_by_admin', responded_at = CURRENT_TIMESTAMP WHERE id = ?`, requestId);
  }
  return ok(undefined, action === 'approve' ? 'Member request approved' : 'Member request rejected');
}
async function memberRequests(env, user, groupId) {
  await ensureManager(env.DB, groupId, user.id, true);
  return ok(await all(env.DB, `SELECT r.*, u.name user_name, u.email user_email, u.name invited_user_name, u.email invited_user_email, inviter.name invited_by_name FROM group_join_requests r
    JOIN users u ON u.id = r.invited_user_id JOIN users inviter ON inviter.id = r.invited_by_user_id
    WHERE r.group_id = ? AND r.status = 'pending_admin' ORDER BY r.created_at DESC`, groupId));
}
async function updateMemberRole(request, env, user, groupId, targetId) {
  const g = await ensureManager(env.DB, groupId, user.id, true);
  if (g.is_disabled) throw new ApiError('This group has been disabled and is now read-only', 409);
  if (targetId === g.admin_id) throw new ApiError('The group admin role cannot be changed');
  const role = (await body(request)).role;
  if (!['co_admin', 'manager', 'member'].includes(role)) throw new ApiError('Role must be co_admin, manager, or member');
  const changed = await run(env.DB, 'UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?', role, groupId, targetId);
  if (!changed.meta.changes) throw new ApiError('Group member not found', 404);
  return ok(undefined, 'Member role updated successfully');
}
async function removeMember(request, env, user, groupId, targetId) {
  const g = await ensureManager(env.DB, groupId, user.id, true);
  if (g.is_disabled) throw new ApiError('This group has been disabled and is now read-only', 409);
  if (targetId === g.admin_id) throw new ApiError('The group admin cannot be removed');
  const reason = required((await body(request)).reason, 'Removal reason');
  const target = await member(env.DB, groupId, targetId);
  if (!target) throw new ApiError('Group member not found', 404);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').bind(groupId, targetId),
    env.DB.prepare('UPDATE group_membership_periods SET ended_at = CURRENT_TIMESTAMP, ended_by_user_id = ?, removal_reason = ? WHERE group_id = ? AND user_id = ? AND ended_at IS NULL').bind(user.id, reason, groupId, targetId)
  ]);
  await log(env.DB, groupId, user.id, 'member_removed', 'Member removed', reason, 'user', targetId);
  return ok(undefined, 'Member removed successfully');
}

async function parseEntry(request, type) {
  const data = await body(request);
  const amount = Number(data.amount);
  const date = type === 'expense' ? data.expenseDate : data.paymentDate;
  if (!Number.isFinite(amount) || amount <= 0) throw new ApiError('Amount must be greater than zero');
  if (!validDate(date)) throw new ApiError(`A valid ${type === 'expense' ? 'expense' : 'payment'} date is required`);
  if (type === 'payment' && !['Cash', 'PayPal'].includes(data.paymentMethod)) throw new ApiError('Payment method must be Cash or PayPal');
  return { data, amount: money(amount), date };
}
async function createEntry(request, env, user, type) {
  const entry = await parseEntry(request, type), groupId = required(entry.data.groupId, 'Group ID');
  await ensureMember(env.DB, groupId, user.id); await ensureActive(env.DB, groupId);
  const month = entry.date.slice(0, 7);
  if (await first(env.DB, 'SELECT id FROM settled_months WHERE group_id = ? AND month = ?', groupId, month)) throw new ApiError('This month has already been settled and is closed for changes', 409);
  const recordId = id();
  if (type === 'expense') await run(env.DB, 'INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date) VALUES (?, ?, ?, ?, ?, ?)', recordId, groupId, user.id, entry.amount, String(entry.data.note || '').trim(), entry.date);
  else await run(env.DB, 'INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date) VALUES (?, ?, ?, ?, ?, ?, ?)', recordId, groupId, user.id, entry.amount, entry.data.paymentMethod, String(entry.data.customerNote || '').trim(), entry.date);
  await log(env.DB, groupId, user.id, `${type}_created`, type === 'expense' ? 'Expense added' : 'Payment recorded', type === 'expense' ? String(entry.data.note || 'Expense') : String(entry.data.customerNote || 'Payment'), type, recordId);
  return ok({ id: recordId }, type === 'expense' ? 'Expense added successfully' : 'Payment recorded successfully', 201);
}
async function listEntries(env, user, type, groupId, query) {
  await ensureMember(env.DB, groupId, user.id);
  const table = type === 'expense' ? 'expenses' : 'payments', date = type === 'expense' ? 'expense_date' : 'payment_date';
  const rows = await all(env.DB, `SELECT r.*, u.name user_name FROM ${table} r JOIN users u ON u.id = r.user_id WHERE r.group_id = ? ORDER BY r.${date} DESC, r.created_at DESC`, groupId);
  return ok(rows.filter(row => (!query.get('month') || row[date].startsWith(query.get('month'))) && (!query.get('memberId') || row.user_id === query.get('memberId')) && (!query.get('search') || JSON.stringify(row).toLowerCase().includes(query.get('search').toLowerCase()))));
}
async function findEntry(env, user, type, recordId) {
  const table = type === 'expense' ? 'expenses' : 'payments';
  const row = await first(env.DB, `SELECT r.*, u.name user_name FROM ${table} r JOIN users u ON u.id = r.user_id WHERE r.id = ?`, recordId);
  if (!row) throw new ApiError(`${type === 'expense' ? 'Expense' : 'Payment'} not found`, 404);
  await ensureMember(env.DB, row.group_id, user.id);
  return row;
}
async function changeEntry(request, env, user, type, recordId) {
  const current = await findEntry(env, user, type, recordId);
  if (current.user_id !== user.id) throw new ApiError(`You can update only your own ${type}s`, 403);
  await ensureActive(env.DB, current.group_id);
  const entry = await parseEntry(request, type);
  if (await first(env.DB, 'SELECT id FROM settled_months WHERE group_id = ? AND month IN (?, ?)', current.group_id, current[type === 'expense' ? 'expense_date' : 'payment_date'].slice(0, 7), entry.date.slice(0, 7))) throw new ApiError('This month has already been settled and is closed for changes', 409);
  if (type === 'expense') await run(env.DB, 'UPDATE expenses SET amount = ?, note = ?, expense_date = ? WHERE id = ?', entry.amount, String(entry.data.note || '').trim(), entry.date, recordId);
  else await run(env.DB, 'UPDATE payments SET amount = ?, payment_method = ?, customer_note = ?, payment_date = ? WHERE id = ?', entry.amount, entry.data.paymentMethod, String(entry.data.customerNote || '').trim(), entry.date, recordId);
  return ok(undefined, `${type === 'expense' ? 'Expense' : 'Payment'} updated successfully`);
}
async function deleteEntry(env, user, type, recordId) {
  const current = await findEntry(env, user, type, recordId);
  if (current.user_id !== user.id) throw new ApiError(`You can delete only your own ${type}s`, 403);
  await ensureActive(env.DB, current.group_id);
  const date = current[type === 'expense' ? 'expense_date' : 'payment_date'];
  if (await first(env.DB, 'SELECT id FROM settled_months WHERE group_id = ? AND month = ?', current.group_id, date.slice(0, 7))) throw new ApiError('This month has already been settled and is closed for changes', 409);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM ${type === 'expense' ? 'expenses' : 'payments'} WHERE id = ?`).bind(recordId),
    env.DB.prepare('INSERT INTO undo_actions (id, user_id, group_id, action_type, entity_type, entity_id, payload_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id(), user.id, current.group_id, 'delete', type, recordId, JSON.stringify(current), nowSeconds() + 300)
  ]);
  await log(env.DB, current.group_id, user.id, `${type}_deleted`, `${type === 'expense' ? 'Expense' : 'Payment'} deleted`, `Deleted ${type}`, type, recordId);
  return ok(undefined, `${type === 'expense' ? 'Expense' : 'Payment'} deleted successfully`);
}

async function personalSummary(env, user) {
  const groups = await all(env.DB, `SELECT g.id, g.name, g.currency, g.is_disabled, gm.role FROM groups g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = ? ORDER BY g.created_at DESC`, user.id);
  const summaries = await Promise.all(groups.map(async g => {
    const result = await settlement(env.DB, g.id, null, true);
    return { groupId: g.id, groupName: g.name, currency: g.currency, role: g.role, isDisabled: Boolean(g.is_disabled), balance: result.memberBalances.find(x => x.id === user.id)?.balance || 0 };
  }));
  const getsTotal = money(summaries.filter(x => x.balance > 0).reduce((sum, x) => sum + x.balance, 0));
  const owesTotal = money(-summaries.filter(x => x.balance < 0).reduce((sum, x) => sum + x.balance, 0));
  return ok({ getsTotal, owesTotal, netBalance: money(getsTotal - owesTotal), groups: summaries });
}
async function createSample(env, user) {
  const groupId = id(), date = new Date(), current = date.toISOString().slice(0, 7);
  date.setUTCMonth(date.getUTCMonth() - 1); const previous = date.toISOString().slice(0, 7);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO groups (id, name, description, currency, admin_id) VALUES (?, 'Sample Coffee Club', 'Example data so you can explore expenses, payments, settlements, and reports.', 'EUR', ?)`).bind(groupId, user.id),
    env.DB.prepare(`INSERT INTO group_members (id, group_id, user_id, role) VALUES (?, ?, ?, 'admin')`).bind(id(), groupId, user.id),
    env.DB.prepare('INSERT INTO group_membership_periods (id, group_id, user_id, created_by_user_id) VALUES (?, ?, ?, ?)').bind(id(), groupId, user.id, user.id),
    env.DB.prepare('INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date) VALUES (?, ?, ?, 38.5, ?, ?)').bind(id(), groupId, user.id, 'Coffee beans', `${previous}-04`),
    env.DB.prepare('INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date) VALUES (?, ?, ?, 21.75, ?, ?)').bind(id(), groupId, user.id, 'Milk and sugar', `${current}-06`),
    env.DB.prepare(`INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date) VALUES (?, ?, ?, 60, 'Cash', ?, ?)`).bind(id(), groupId, user.id, 'Morning orders', `${previous}-10`),
    env.DB.prepare(`INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date) VALUES (?, ?, ?, 54.2, 'Cash', ?, ?)`).bind(id(), groupId, user.id, 'Office delivery', `${current}-11`),
    env.DB.prepare('INSERT INTO settled_months (id, group_id, month, settled_by_user_id) VALUES (?, ?, ?, ?)').bind(id(), groupId, previous, user.id),
    env.DB.prepare('UPDATE users SET onboarding_completed = 1, onboarding_seen_at = CURRENT_TIMESTAMP WHERE id = ?').bind(user.id)
  ]);
  await log(env.DB, groupId, user.id, 'sample_group_created', 'Sample group created', 'Created a sample group with example records', 'group', groupId);
  return ok({ id: groupId }, 'Sample example created successfully', 201);
}
async function settleGroup(request, env, user, groupId) {
  await ensureMember(env.DB, groupId, user.id); await ensureActive(env.DB, groupId);
  const month = validMonth((await body(request)).month);
  if (!month) throw new ApiError('A valid month is required');
  if (await first(env.DB, 'SELECT id FROM settled_months WHERE group_id = ? AND month = ?', groupId, month)) throw new ApiError('This month has already been settled', 409);
  const calculated = await settlement(env.DB, groupId, month);
  if (calculated.totalReceived <= 0) throw new ApiError('Settle up is available only after money is received for that month');
  await run(env.DB, 'INSERT INTO settled_months (id, group_id, month, settled_by_user_id) VALUES (?, ?, ?, ?)', id(), groupId, month, user.id);
  await log(env.DB, groupId, user.id, 'month_settled', 'Month settled', `Settled ${month}`, 'settlement', month, { month });
  const settled = await first(env.DB, `SELECT s.*, u.name settled_by_name FROM settled_months s JOIN users u ON u.id = s.settled_by_user_id WHERE s.group_id = ? AND s.month = ?`, groupId, month);
  return ok({ ...calculated, isSettled: true, settledAt: settled.settled_at, settledByUserId: settled.settled_by_user_id, settledByName: settled.settled_by_name }, 'Month settled successfully', 201);
}
async function settlementHistory(env, user, groupId) {
  await ensureMember(env.DB, groupId, user.id);
  return ok(await settlementHistoryRows(env.DB, groupId));
}
async function settlementHistoryRows(db, groupId) {
  const months = await all(db, `SELECT month FROM (
    SELECT DISTINCT substr(expense_date, 1, 7) month FROM expenses WHERE group_id = ?
    UNION
    SELECT DISTINCT substr(payment_date, 1, 7) month FROM payments WHERE group_id = ?
  ) ORDER BY month DESC`, groupId, groupId);
  const settled = await all(db, `SELECT s.month, s.settled_at, s.settled_by_user_id, u.name settled_by_name FROM settled_months s JOIN users u ON u.id = s.settled_by_user_id WHERE s.group_id = ?`, groupId);
  const byMonth = new Map(settled.map(item => [item.month, item]));
  return Promise.all(months.map(async ({ month }) => {
    const settledMonth = byMonth.get(month);
    return {
      ...await settlement(db, groupId, month),
      month,
      isSettled: Boolean(settledMonth),
      settledAt: settledMonth?.settled_at || null,
      settledByUserId: settledMonth?.settled_by_user_id || null,
      settledByName: settledMonth?.settled_by_name || null
    };
  }));
}
async function inbox(env, user, query) {
  const unreadOnly = query.get('unreadOnly') === 'true', limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), 100);
  const notifications = await all(env.DB, `SELECT n.id, n.group_id, n.type, n.title, n.message, n.action_url, n.metadata_json, n.is_read, n.read_at, n.created_at, g.name group_name FROM inbox_notifications n LEFT JOIN groups g ON g.id = n.group_id WHERE n.user_id = ? ${unreadOnly ? 'AND n.is_read = 0' : ''} ORDER BY n.created_at DESC LIMIT ?`, user.id, limit);
  return ok({ unreadCount: (await first(env.DB, 'SELECT COUNT(*) count FROM inbox_notifications WHERE user_id = ? AND is_read = 0', user.id)).count, notifications: notifications.map(x => ({ ...x, isRead: Boolean(x.is_read), actionUrl: x.action_url, metadata: x.metadata_json ? JSON.parse(x.metadata_json) : null })) });
}
async function activity(env, user, groupId, query) {
  await ensureMember(env.DB, groupId, user.id);
  const rows = await all(env.DB, `SELECT a.*, u.name user_name FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.group_id = ? ORDER BY a.created_at DESC LIMIT ?`, groupId, Math.min(Math.max(Number(query.get('limit')) || 100, 1), 200));
  return ok(rows.filter(x => (!query.get('month') || x.created_at.startsWith(query.get('month'))) && (!query.get('memberId') || x.user_id === query.get('memberId')) && (!query.get('type') || x.activity_type === query.get('type')) && (!query.get('search') || `${x.title} ${x.description}`.toLowerCase().includes(query.get('search').toLowerCase()))));
}
function normalTemplate(data) {
  return {
    entryType: data.entryType ?? data.entry_type, title: String(data.title || '').trim(), amount: Number(data.amount),
    note: String(data.note || '').trim(), paymentMethod: data.paymentMethod ?? data.payment_method ?? 'Cash',
    frequency: data.frequency, dayOfWeek: data.dayOfWeek === '' || data.dayOfWeek === undefined ? null : Number(data.dayOfWeek),
    dayOfMonth: data.dayOfMonth === '' || data.dayOfMonth === undefined ? null : Number(data.dayOfMonth),
    isActive: data.isActive === undefined ? (data.is_active === undefined ? 1 : Number(data.is_active)) : Number(Boolean(data.isActive))
  };
}
function validateTemplate(t) {
  if (!['expense', 'payment'].includes(t.entryType)) return 'Entry type must be expense or payment';
  if (!t.title) return 'Template title is required';
  if (!Number.isFinite(t.amount) || t.amount <= 0) return 'Template amount must be greater than zero';
  if (!['weekly', 'monthly'].includes(t.frequency)) return 'Frequency must be weekly or monthly';
  if (t.entryType === 'payment' && !['Cash', 'PayPal'].includes(t.paymentMethod)) return 'Payment method must be Cash or PayPal';
  if (t.frequency === 'weekly' && (!Number.isInteger(t.dayOfWeek) || t.dayOfWeek < 0 || t.dayOfWeek > 6 || t.dayOfMonth !== null)) return 'Weekly templates require a weekday between 0 and 6';
  if (t.frequency === 'monthly' && (!Number.isInteger(t.dayOfMonth) || t.dayOfMonth < 1 || t.dayOfMonth > 31 || t.dayOfWeek !== null)) return 'Monthly templates require a day of month between 1 and 31';
  return null;
}
async function templates(request, env, user, groupId, templateId = null) {
  await ensureMember(env.DB, groupId, user.id);
  if (request.method === 'GET') return ok(await all(env.DB, `SELECT r.*, u.name user_name FROM recurring_templates r JOIN users u ON u.id = r.user_id WHERE r.group_id = ? ORDER BY r.is_active DESC, r.updated_at DESC`, groupId));
  const g = await ensureActive(env.DB, groupId);
  if (templateId) {
    const current = await first(env.DB, 'SELECT * FROM recurring_templates WHERE id = ? AND group_id = ?', templateId, groupId);
    if (!current) throw new ApiError('Recurring template not found', 404);
    if (current.user_id !== user.id) throw new ApiError(`You can ${request.method === 'DELETE' ? 'delete' : 'update'} only your own recurring templates`, 403);
    if (request.method === 'DELETE') { await run(env.DB, 'DELETE FROM recurring_templates WHERE id = ?', templateId); return ok(undefined, 'Recurring template deleted successfully'); }
    const t = normalTemplate({ ...current, ...await body(request) }), error = validateTemplate(t); if (error) throw new ApiError(error);
    await run(env.DB, `UPDATE recurring_templates SET entry_type=?, title=?, amount=?, note=?, payment_method=?, frequency=?, day_of_week=?, day_of_month=?, is_active=? WHERE id=?`, t.entryType, t.title, money(t.amount), t.note, t.entryType === 'payment' ? t.paymentMethod : null, t.frequency, t.dayOfWeek, t.dayOfMonth, t.isActive, templateId);
    await log(env.DB, groupId, user.id, 'template_updated', 'Recurring template updated', `Updated recurring template "${t.title}"`, 'template', templateId);
    return ok(undefined, 'Recurring template updated successfully');
  }
  const t = normalTemplate(await body(request)), error = validateTemplate(t); if (error) throw new ApiError(error);
  const templateIdNew = id();
  await run(env.DB, `INSERT INTO recurring_templates (id, group_id, user_id, entry_type, title, amount, note, payment_method, frequency, day_of_week, day_of_month, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, templateIdNew, groupId, user.id, t.entryType, t.title, money(t.amount), t.note, t.entryType === 'payment' ? t.paymentMethod : null, t.frequency, t.dayOfWeek, t.dayOfMonth, t.isActive);
  await log(env.DB, groupId, user.id, 'template_created', 'Recurring template created', `Created recurring ${t.entryType} template "${t.title}"`, 'template', templateIdNew);
  return ok({ id: templateIdNew }, 'Recurring template created successfully', 201);
}
async function useTemplate(request, env, user, groupId, templateId) {
  await ensureMember(env.DB, groupId, user.id); await ensureActive(env.DB, groupId);
  const template = await first(env.DB, 'SELECT * FROM recurring_templates WHERE id = ? AND group_id = ? AND is_active = 1', templateId, groupId);
  if (!template) throw new ApiError('Recurring template not found', 404);
  const date = String((await body(request)).date || new Date().toISOString().slice(0, 10));
  if (!validDate(date)) throw new ApiError('A valid date is required');
  if (await first(env.DB, 'SELECT id FROM settled_months WHERE group_id = ? AND month = ?', groupId, date.slice(0, 7))) throw new ApiError('This month has already been settled and is closed for changes', 409);
  const recordId = id();
  if (template.entry_type === 'expense') await run(env.DB, 'INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date) VALUES (?, ?, ?, ?, ?, ?)', recordId, groupId, user.id, template.amount, template.note || template.title, date);
  else await run(env.DB, 'INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date) VALUES (?, ?, ?, ?, ?, ?, ?)', recordId, groupId, user.id, template.amount, template.payment_method, template.note || template.title, date);
  await run(env.DB, 'UPDATE recurring_templates SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', templateId);
  await log(env.DB, groupId, user.id, 'template_used', 'Recurring template used', `Created ${template.entry_type} from template "${template.title}"`, template.entry_type, recordId, { templateId });
  return ok({ recordId, entryType: template.entry_type }, `${template.entry_type === 'expense' ? 'Expense' : 'Payment'} created from recurring template`, 201);
}

async function latestUndo(env, user) {
  const action = await first(env.DB, `SELECT * FROM undo_actions WHERE user_id = ? AND undone_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`, user.id, nowSeconds());
  return ok(action ? { ...action, payload: JSON.parse(action.payload_json), label: undoLabel(JSON.parse(action.payload_json)) } : null);
}
async function undo(env, user, actionId) {
  const action = await first(env.DB, `SELECT * FROM undo_actions WHERE id = ? AND user_id = ? AND undone_at IS NULL AND expires_at > ?`, actionId, user.id, nowSeconds());
  if (!action) throw new ApiError('Undo action not found or expired', 404);
  const record = JSON.parse(action.payload_json);
  if (action.entity_type === 'expense') await run(env.DB, 'INSERT INTO expenses (id, group_id, user_id, amount, note, expense_date) VALUES (?, ?, ?, ?, ?, ?)', record.id, record.group_id, record.user_id, record.amount, record.note, record.expense_date);
  else if (action.entity_type === 'payment') await run(env.DB, 'INSERT INTO payments (id, group_id, user_id, amount, payment_method, customer_note, payment_date) VALUES (?, ?, ?, ?, ?, ?, ?)', record.id, record.group_id, record.user_id, record.amount, record.payment_method, record.customer_note, record.payment_date);
  else throw new ApiError('This action cannot be undone', 409);
  await run(env.DB, 'UPDATE undo_actions SET undone_at = CURRENT_TIMESTAMP, undone_by_user_id = ? WHERE id = ?', user.id, actionId);
  return ok({ ...action, payload: record, label: undoLabel(record) }, 'Recent action undone successfully');
}
function undoLabel(record) {
  const description = record.note || record.customer_note || record.title || '';
  return `Restore ${record.entity_type || (record.payment_method ? 'payment' : 'expense')}${description ? `: ${description}` : ''}`;
}
async function feedback(request, env, user) {
  const data = await body(request), name = String(data.name || user?.name || '').trim(), email = String(data.email || user?.email || '').trim().toLowerCase();
  const category = String(data.category || '').trim().toLowerCase(), subject = String(data.subject || '').trim(), message = String(data.message || '').trim();
  if (!name || !email || !category || !subject || !message) throw new ApiError('Name, email, category, subject, and message are required');
  if (!['bug', 'feature', 'help', 'general'].includes(category)) throw new ApiError('Category must be bug, feature, help, or general');
  if (data.termsAccepted !== true) throw new ApiError('You must accept the terms and conditions before submitting feedback');
  const feedbackId = id(), ticketNumber = `FDB-${feedbackId.replaceAll('-', '').slice(0, 10).toUpperCase()}`;
  await run(env.DB, `INSERT INTO feedback_submissions (id, user_id, name, email, category, subject, message, ticket_number, terms_accepted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, feedbackId, user?.id || null, name, email, category, subject, message, ticketNumber);
  return ok({ id: feedbackId, ticketNumber, category, subject }, 'Thanks for your feedback. We saved your message successfully.', 201);
}
async function deleteRequest(env, user, groupId) {
  const g = await ensureManager(env.DB, groupId, user.id, true);
  if (g.is_disabled) throw new ApiError('This group has been disabled and is now read-only', 409);
  if (await first(env.DB, 'SELECT id FROM group_delete_requests WHERE group_id = ?', groupId)) throw new ApiError('A deletion request already exists', 409);
  const members = await all(env.DB, 'SELECT user_id FROM group_members WHERE group_id = ?', groupId), requestId = id();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO group_delete_requests (id, group_id, requested_by_user_id) VALUES (?, ?, ?)').bind(requestId, groupId, user.id),
    ...members.map(row => env.DB.prepare('INSERT INTO group_delete_approvals (id, request_id, group_id, user_id, approved_at) VALUES (?, ?, ?, ?, ?)').bind(id(), requestId, groupId, row.user_id, row.user_id === user.id ? new Date().toISOString() : null))
  ]);
  await Promise.all(members.filter(x => x.user_id !== user.id).map(x => notify(env.DB, x.user_id, groupId, 'group_deletion', 'Group deletion approval needed', `${user.name} requested that ${g.name} be disabled`, `/group/${groupId}`)));
  return ok({ id: requestId }, 'Group deletion request created');
}
async function approveDelete(env, user, groupId) {
  await ensureMember(env.DB, groupId, user.id);
  const request = await first(env.DB, 'SELECT id FROM group_delete_requests WHERE group_id = ?', groupId);
  if (!request) throw new ApiError('No deletion request exists for this group', 404);
  await run(env.DB, 'UPDATE group_delete_approvals SET approved_at = CURRENT_TIMESTAMP WHERE request_id = ? AND user_id = ? AND approved_at IS NULL', request.id, user.id);
  const outstanding = await first(env.DB, 'SELECT COUNT(*) count FROM group_delete_approvals WHERE request_id = ? AND approved_at IS NULL', request.id);
  if (!outstanding.count) {
    await run(env.DB, 'UPDATE groups SET is_disabled = 1, disabled_at = CURRENT_TIMESTAMP, disabled_by_user_id = ? WHERE id = ?', user.id, groupId);
    await log(env.DB, groupId, user.id, 'group_disabled', 'Group disabled', 'This group is now read-only', 'group', groupId);
    return ok({ isDisabled: true }, 'All members approved. Group disabled successfully.');
  }
  return ok({ pendingApprovals: outstanding.count }, 'Deletion approval recorded');
}
async function pendingDeletions(env, user) {
  return ok(await all(env.DB, `SELECT r.id, r.group_id, r.requested_at, g.name group_name, requester.id requested_by_user_id, requester.name requested_by_name,
    (SELECT COUNT(*) FROM group_delete_approvals a WHERE a.request_id = r.id AND a.approved_at IS NOT NULL) approved_count,
    (SELECT COUNT(*) FROM group_delete_approvals a WHERE a.request_id = r.id) total_approvals
    FROM group_delete_requests r JOIN group_delete_approvals mine ON mine.request_id = r.id AND mine.user_id = ? AND mine.approved_at IS NULL
    JOIN groups g ON g.id = r.group_id JOIN users requester ON requester.id = r.requested_by_user_id ORDER BY r.requested_at DESC`, user.id));
}

async function handle(request, env) {
  const url = new URL(request.url), path = url.pathname.replace(/^\/api\/?/, '/').replace(/\/+$/, '') || '/';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
  if (path === '/health' && request.method === 'GET') return ok({ status: 'ok' });
  if (path === '/auth/register' && request.method === 'POST') return authRegister(request, env);
  if (path === '/auth/login' && request.method === 'POST') return authLogin(request, env);
  if (path === '/auth/google' || path === '/auth/activate') return fail('This free-tier Worker supports email/password authentication only', 501);
  if (path === '/support/feedback' && request.method === 'POST') return feedback(request, env, (await readToken(request, env, true)) ? (await auth(request, env)).user : null);
  const authenticated = await auth(request, env);
  if (authenticated.error) return authenticated.error;
  const { user, claims } = authenticated;
  if (path === '/auth/me' && request.method === 'GET') return ok(publicUser(user));
  if (path === '/auth/profile' && request.method === 'PUT') return updateProfile(request, env, user);
  if (path === '/auth/logout' && request.method === 'POST') { await run(env.DB, 'INSERT OR IGNORE INTO token_revocations (jti, user_id, expires_at) VALUES (?, ?, ?)', claims.jti, user.id, claims.exp); return ok(undefined, 'Logged out successfully'); }
  if (path === '/groups' && request.method === 'POST') return createGroup(request, env, user);
  if (path === '/groups' && request.method === 'GET') return listGroups(env, user);
  if (path === '/groups/personal-summary' && request.method === 'GET') return personalSummary(env, user);
  if (path === '/groups/sample' && request.method === 'POST') return createSample(env, user);
  if (path === '/groups/invitations/received' && request.method === 'GET') return invitations(env, user);
  if (path === '/groups/deletion-requests/pending' && request.method === 'GET') return pendingDeletions(env, user);
  let match;
  if ((match = path.match(/^\/groups\/invitations\/([^/]+)\/respond$/)) && request.method === 'POST') return respondInvitation(request, env, user, match[1]);
  if ((match = path.match(/^\/groups\/([^/]+)\/members$/)) && request.method === 'POST') return inviteMember(request, env, user, match[1]);
  if ((match = path.match(/^\/groups\/([^/]+)\/member-requests$/)) && request.method === 'GET') return memberRequests(env, user, match[1]);
  if ((match = path.match(/^\/groups\/([^/]+)\/member-requests\/([^/]+)\/review$/)) && request.method === 'POST') return reviewInvitation(request, env, user, match[1], match[2]);
  if ((match = path.match(/^\/groups\/([^/]+)\/members\/([^/]+)\/role$/)) && request.method === 'PUT') return updateMemberRole(request, env, user, match[1], match[2]);
  if ((match = path.match(/^\/groups\/([^/]+)\/members\/([^/]+)$/)) && request.method === 'DELETE') return removeMember(request, env, user, match[1], match[2]);
  if ((match = path.match(/^\/groups\/([^/]+)\/delete-request$/)) && request.method === 'POST') return deleteRequest(env, user, match[1]);
  if ((match = path.match(/^\/groups\/([^/]+)\/delete-request\/approve$/)) && request.method === 'POST') return approveDelete(env, user, match[1]);
  if ((match = path.match(/^\/groups\/([^/]+)$/))) { if (request.method === 'GET') return groupDetail(env, user, match[1]); if (request.method === 'PUT') return updateGroup(request, env, user, match[1]); }
  if (path === '/expenses' && request.method === 'POST') return createEntry(request, env, user, 'expense');
  if (path === '/payments' && request.method === 'POST') return createEntry(request, env, user, 'payment');
  if ((match = path.match(/^\/(expenses|payments)\/group\/([^/]+)$/)) && request.method === 'GET') return listEntries(env, user, match[1] === 'expenses' ? 'expense' : 'payment', match[2], url.searchParams);
  if ((match = path.match(/^\/(expenses|payments)\/([^/]+)$/))) { const type = match[1] === 'expenses' ? 'expense' : 'payment'; if (request.method === 'GET') return ok(await findEntry(env, user, type, match[2])); if (request.method === 'PUT') return changeEntry(request, env, user, type, match[2]); if (request.method === 'DELETE') return deleteEntry(env, user, type, match[2]); }
  if ((match = path.match(/^\/settlement\/group\/([^/]+)$/)) && request.method === 'GET') { await ensureMember(env.DB, match[1], user.id); return ok(await settlement(env.DB, match[1], null, true)); }
  if ((match = path.match(/^\/settlement\/group\/([^/]+)\/history$/)) && request.method === 'GET') return settlementHistory(env, user, match[1]);
  if ((match = path.match(/^\/settlement\/group\/([^/]+)\/settle$/)) && request.method === 'POST') return settleGroup(request, env, user, match[1]);
  if ((match = path.match(/^\/reports\/group\/([^/]+)\/monthly-summary$/)) && request.method === 'GET') { await ensureMember(env.DB, match[1], user.id); return ok(await report(env.DB, match[1], url.searchParams.get('month'))); }
  if ((match = path.match(/^\/reports\/group\/([^/]+)\/export\.csv$/)) && request.method === 'GET') {
    await ensureMember(env.DB, match[1], user.id); const result = await report(env.DB, match[1], url.searchParams.get('month'));
    const content = [['Type', 'Date', 'Member', 'Description', 'Amount'], ...result.records.expenses.map(x => ['Expense', x.expense_date, x.user_name, x.note, x.amount]), ...result.records.payments.map(x => ['Payment', x.payment_date, x.user_name, x.customer_note, x.amount])].map(row => row.map(csvEscape).join(',')).join('\r\n');
    return new Response(content, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${match[1]}-${result.month}-summary.csv"` } });
  }
  if (path.includes('/export.pdf')) return fail('PDF export is not supported by this dependency-free free-tier Worker', 501);
  if (path === '/inbox' && request.method === 'GET') return inbox(env, user, url.searchParams);
  if ((match = path.match(/^\/inbox\/([^/]+)\/read$/)) && request.method === 'POST') { await run(env.DB, 'UPDATE inbox_notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', match[1], user.id); return ok({ unreadCount: (await first(env.DB, 'SELECT COUNT(*) count FROM inbox_notifications WHERE user_id = ? AND is_read = 0', user.id)).count }, 'Notification marked as read'); }
  if (path === '/inbox/read-all' && request.method === 'POST') { await run(env.DB, 'UPDATE inbox_notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_read = 0', user.id); return ok({ unreadCount: 0 }, 'All notifications marked as read'); }
  if ((match = path.match(/^\/activity\/group\/([^/]+)$/)) && request.method === 'GET') return activity(env, user, match[1], url.searchParams);
  if ((match = path.match(/^\/recurring\/group\/([^/]+)$/)) && ['GET', 'POST'].includes(request.method)) return templates(request, env, user, match[1]);
  if ((match = path.match(/^\/recurring\/group\/([^/]+)\/([^/]+)\/use$/)) && request.method === 'POST') return useTemplate(request, env, user, match[1], match[2]);
  if ((match = path.match(/^\/recurring\/group\/([^/]+)\/([^/]+)$/)) && ['PUT', 'DELETE'].includes(request.method)) return templates(request, env, user, match[1], match[2]);
  if (path === '/undo/latest' && request.method === 'GET') return latestUndo(env, user);
  if ((match = path.match(/^\/undo\/([^/]+)$/)) && request.method === 'POST') return undo(env, user, match[1]);
  return fail('Endpoint not found', 404);
}

export default {
  async fetch(request, env) {
    try { return withCors(await handle(request, env), request, env); }
    catch (error) {
      console.error(error);
      return withCors(fail(error instanceof ApiError ? error.message : 'Internal server error', error instanceof ApiError ? error.status : 500), request, env);
    }
  }
};
