/**
 * Пользователи, сессии и регистрация — PostgreSQL или db.json (fallback)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const security = require('./security');
const { normalizeObjectIds } = require('./project-scope');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const SCHEMA_PATH = path.join(__dirname, 'db', 'schema.sql');
const SESSION_DAYS = 30;
const SYSTEM_NOTIFY_EMAIL = (
  process.env.DEFAULT_NOTIFY_EMAIL || process.env.SMTP_USER || ''
).toLowerCase();
const LEGACY_NOTIFY_EMAILS = new Set(
  (process.env.BLOCK_NOTIFY_EMAILS || '')
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

let pool = null;
let usePg = false;

function pgEnabled() {
  return usePg && !!pool;
}

function getPool() {
  if (!pool) throw new Error('PostgreSQL не инициализирован');
  return pool;
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    contractorId: row.contractor_id || null,
    objectIds: normalizeObjectIds(row.object_ids),
    notifyEmail: row.notify_email || '',
    notificationSettings: row.notification_settings || {},
    googleRefreshToken: row.google_refresh_token || null,
    googleAccessToken: row.google_access_token || null,
    googleEmail: row.google_email || null,
    telegramChatId: row.telegram_chat_id || null,
    avatarUrl: row.avatar_url || null,
    status: row.status || 'active',
    company: row.company || '',
    phone: row.phone || '',
    jobTitle: row.job_title || '',
    approvalRequestedAt: row.approval_requested_at || null,
    tutorialCompleted: !!row.tutorial_completed,
    createdAt: row.created_at,
  };
}

function jsonUserToRecord(u) {
  return {
    id: u.id,
    email: u.email,
    passwordHash: u.passwordHash || u.password,
    role: u.role || 'auditor',
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    contractorId: u.contractorId || null,
    objectIds: normalizeObjectIds(u.objectIds),
    notifyEmail: u.notifyEmail || SYSTEM_NOTIFY_EMAIL,
    notificationSettings: u.notificationSettings || {},
    googleRefreshToken: u.googleRefreshToken || null,
    googleAccessToken: u.googleAccessToken || null,
    googleEmail: u.googleEmail || null,
    telegramChatId: u.telegramChatId || null,
    avatarUrl: u.avatarUrl || null,
    status: u.status || 'active',
    company: u.company || '',
    phone: u.phone || '',
    jobTitle: u.jobTitle || u.job_title || '',
    approvalRequestedAt: u.approvalRequestedAt || null,
    tutorialCompleted: !!u.tutorialCompleted,
    createdAt: u.createdAt || null,
  };
}

async function updatePasswordHash(userId, passwordHash) {
  if (pgEnabled()) {
    await getPool().query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    return;
  }
  const db = readJsonDb();
  const u = db.users.find((x) => x.id === userId);
  if (!u) return;
  u.passwordHash = passwordHash;
  delete u.password;
  writeJsonDb(db);
}

function readJsonDb() {
  const empty = { users: [], sessions: [], registrationPending: {}, passwordResetPending: {} };
  try {
    if (!fs.existsSync(DB_PATH)) return empty;
    const raw = fs.readFileSync(DB_PATH, 'utf8').trim();
    if (!raw) return empty;
    const db = JSON.parse(raw);
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.sessions)) db.sessions = [];
    if (!db.registrationPending) db.registrationPending = {};
    if (!db.passwordResetPending) db.passwordResetPending = {};
    return db;
  } catch {
    return empty;
  }
}

function writeJsonDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

async function runSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await getPool().query(sql);
}

async function migrateFromJsonIfEmpty() {
  const { rows } = await getPool().query('SELECT COUNT(*)::int AS c FROM users');
  if (rows[0].c > 0) return;
  const db = readJsonDb();
  if (!db.users.length) return;
  console.log(`PostgreSQL: импорт ${db.users.length} пользователей из db.json…`);
  for (const u of db.users) {
    const hash =
      u.passwordHash && security.isSecureHash(u.passwordHash)
        ? u.passwordHash
        : u.password && u.password.startsWith('$2')
          ? u.password
          : await security.hashPassword(u.password || 'changeme');
    await getPool().query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, contractor_id, notify_email,
        notification_settings, google_refresh_token, google_access_token, google_email, telegram_chat_id, status, company, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
      [
        u.id,
        u.email.toLowerCase(),
        hash,
        u.role || 'auditor',
        u.firstName || '',
        u.lastName || '',
        u.contractorId || null,
        u.notifyEmail || u.email,
        JSON.stringify(u.notificationSettings || {}),
        u.googleRefreshToken || null,
        u.googleAccessToken || null,
        u.googleEmail || null,
        u.telegramChatId || null,
        u.status || 'active',
        u.company || '',
        u.phone || '',
      ]
    );
  }
}

async function migrateJsonPasswordsToArgon() {
  const db = readJsonDb();
  let changed = false;
  for (const u of db.users) {
    if (security.isSecureHash(u.passwordHash)) {
      if (u.password) {
        delete u.password;
        changed = true;
      }
      continue;
    }
    if (u.password) {
      u.passwordHash = await security.hashPassword(u.password);
      delete u.password;
      changed = true;
    }
  }
  if (changed) {
    writeJsonDb(db);
    console.log('  Пароли в db.json: переведены на Argon2id');
  }
}

async function migrateNotifyEmailsToSystemInbox() {
  const shouldReplace = (email) => {
    const e = String(email || '').trim().toLowerCase();
    return !e || LEGACY_NOTIFY_EMAILS.has(e);
  };
  if (pgEnabled()) {
    const { rowCount } = await getPool().query(
      `UPDATE users SET notify_email = $1
       WHERE notify_email IS NULL OR notify_email = '' OR LOWER(notify_email) = ANY($2::text[])`,
      [SYSTEM_NOTIFY_EMAIL, [...LEGACY_NOTIFY_EMAILS]]
    );
    if (rowCount > 0) {
      console.log(`  notify_email → ${SYSTEM_NOTIFY_EMAIL} (${rowCount} пользов.)`);
    }
    return;
  }
  const db = readJsonDb();
  let changed = 0;
  db.users.forEach((u) => {
    if (shouldReplace(u.notifyEmail)) {
      u.notifyEmail = SYSTEM_NOTIFY_EMAIL;
      changed++;
    }
  });
  if (changed) {
    writeJsonDb(db);
    console.log(`  notify_email → ${SYSTEM_NOTIFY_EMAIL} (${changed} пользов.)`);
  }
}

async function syncMissingUsersFromJson() {
  if (!pgEnabled()) return;
  const db = readJsonDb();
  if (!db.users?.length) return;
  let added = 0;
  for (const u of db.users) {
    if (await findByEmail(u.email)) continue;
    const hash =
      u.passwordHash && security.isSecureHash(u.passwordHash)
        ? u.passwordHash
        : u.password && u.password.startsWith('$')
          ? u.password
          : await security.hashPassword(u.password || 'changeme');
    await getPool().query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, contractor_id, notify_email,
        notification_settings, google_refresh_token, google_access_token, google_email, telegram_chat_id, status, company, phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (id) DO NOTHING`,
      [
        u.id,
        u.email.toLowerCase(),
        hash,
        u.role || 'viewer',
        u.firstName || '',
        u.lastName || '',
        u.contractorId || null,
        u.notifyEmail || u.email,
        JSON.stringify(u.notificationSettings || {}),
        u.googleRefreshToken || null,
        u.googleAccessToken || null,
        u.googleEmail || null,
        u.telegramChatId || null,
        u.status || 'active',
        u.company || '',
        u.phone || '',
      ]
    );
    added++;
  }
  if (added) console.log(`  PostgreSQL: добавлено ${added} пользователей из db.json`);
}

async function listRegistrationPending() {
  const now = Date.now();
  if (pgEnabled()) {
    await getPool().query('DELETE FROM registration_pending WHERE expires_at < $1', [now]);
    const { rows } = await getPool().query(
      `SELECT email, first_name, last_name, full_name, company, phone, expires_at
       FROM registration_pending WHERE expires_at >= $1 ORDER BY expires_at DESC`,
      [now]
    );
    return rows.map((r) => ({
      email: r.email,
      firstName: r.first_name || '',
      lastName: r.last_name || '',
      name: r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      company: r.company || '',
      phone: r.phone || '',
      expiresAt: Number(r.expires_at),
    }));
  }
  const db = readJsonDb();
  const out = [];
  Object.keys(db.registrationPending || {}).forEach((email) => {
    const row = db.registrationPending[email];
    if (!row || (row.expiresAt || 0) < now) return;
    out.push({
      email,
      firstName: row.firstName || '',
      lastName: row.lastName || '',
      name: row.fullName || `${row.firstName || ''} ${row.lastName || ''}`.trim(),
      company: row.company || '',
      phone: row.phone || '',
      expiresAt: row.expiresAt,
    });
  });
  return out.sort((a, b) => (b.expiresAt || 0) - (a.expiresAt || 0));
}

async function initJsonMode() {
  console.log('  БД пользователей: db.json (задайте DATABASE_URL для PostgreSQL)');
  usePg = false;
  pool = null;
  await migrateJsonPasswordsToArgon();
  const admin = await ensureAdminUser({
    email: process.env.VC_ADMIN_EMAIL || 'admin@victory-check.ru',
    password: process.env.VC_ADMIN_PASSWORD || 'VictoryAdmin2026!',
    firstName: process.env.VC_ADMIN_FIRST_NAME || 'Victory',
    lastName: process.env.VC_ADMIN_LAST_NAME || 'Admin',
  });
  if (admin.created) {
    console.log(`  Админ создан: ${admin.email} (пароль по умолчанию — см. README)`);
  }
  await migrateNotifyEmailsToSystemInbox();
}

async function initPgMode(url) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: url });
  await pool.query('SELECT 1');
  usePg = true;
  await runSchema();
  await getPool()
    .query('ALTER TABLE users ALTER COLUMN password_hash TYPE VARCHAR(512)')
    .catch(() => {});
  await getPool()
    .query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT')
    .catch(() => {});
  await getPool()
    .query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT 'active'")
    .catch(() => {});
  await getPool()
    .query("ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(512) NOT NULL DEFAULT ''")
    .catch(() => {});
  await getPool()
    .query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(64) NOT NULL DEFAULT ''")
    .catch(() => {});
  await getPool()
    .query("ALTER TABLE users ADD COLUMN IF NOT EXISTS object_ids JSONB NOT NULL DEFAULT '[]'")
    .catch(() => {});
  await getPool()
    .query('ALTER TABLE registration_pending ADD COLUMN IF NOT EXISTS company VARCHAR(512) NOT NULL DEFAULT \'\'')
    .catch(() => {});
  await getPool()
    .query('ALTER TABLE registration_pending ADD COLUMN IF NOT EXISTS phone VARCHAR(64) NOT NULL DEFAULT \'\'')
    .catch(() => {});
  await getPool()
    .query("ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(256) NOT NULL DEFAULT ''")
    .catch(() => {});
  await getPool()
    .query("ALTER TABLE registration_pending ADD COLUMN IF NOT EXISTS job_title VARCHAR(256) NOT NULL DEFAULT ''")
    .catch(() => {});
  await getPool()
    .query('ALTER TABLE users ADD COLUMN IF NOT EXISTS tutorial_completed BOOLEAN NOT NULL DEFAULT false')
    .catch(() => {});
  await getPool()
    .query(
      `CREATE TABLE IF NOT EXISTS password_reset_pending (
        email VARCHAR(255) PRIMARY KEY,
        code VARCHAR(10) NOT NULL,
        expires_at BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    )
    .catch(() => {});
  await migrateFromJsonIfEmpty();
  await syncMissingUsersFromJson();
  await migrateNotifyEmailsToSystemInbox();
  await ensureAdminUser({
    email: process.env.VC_ADMIN_EMAIL || 'admin@victory-check.ru',
    password: process.env.VC_ADMIN_PASSWORD || 'VictoryAdmin2026!',
    firstName: process.env.VC_ADMIN_FIRST_NAME || 'Victory',
    lastName: process.env.VC_ADMIN_LAST_NAME || 'Admin',
  });
  console.log('  БД пользователей: PostgreSQL');
}

async function init() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    await initJsonMode();
    return;
  }
  try {
    await initPgMode(url);
  } catch (e) {
    console.warn('  PostgreSQL недоступен:', e.message || e);
    console.warn('  Резерв: db.json (запустите PostgreSQL: sudo pg_ctlcluster 18 main start)');
    await initJsonMode();
  }
}

async function getUserById(id) {
  if (!id) return null;
  if (pgEnabled()) {
    const { rows } = await getPool().query('SELECT * FROM users WHERE id = $1', [id]);
    return rowToUser(rows[0]);
  }
  const db = readJsonDb();
  const u = db.users.find((x) => x.id === id);
  return u ? jsonUserToRecord(u) : null;
}

async function findByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  if (pgEnabled()) {
    const { rows } = await getPool().query('SELECT * FROM users WHERE LOWER(email) = $1', [e]);
    return rowToUser(rows[0]);
  }
  const db = readJsonDb();
  const u = db.users.find((x) => x.email.toLowerCase() === e);
  return u ? jsonUserToRecord(u) : null;
}

async function emailExists(email) {
  return !!(await findByEmail(email));
}

async function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_DAYS * 86400000;
  if (pgEnabled()) {
    await getPool().query('DELETE FROM sessions WHERE expires_at < $1', [Date.now()]);
    await getPool().query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)', [
      token,
      userId,
      expiresAt,
    ]);
    return token;
  }
  const db = readJsonDb();
  db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now());
  db.sessions.push({ token, userId, expiresAt });
  writeJsonDb(db);
  return token;
}

async function getUserIdByToken(token) {
  if (!token) return null;
  const now = Date.now();
  const freshUntil = now + SESSION_DAYS * 86400000;
  if (pgEnabled()) {
    const { rows } = await getPool().query(
      'SELECT user_id FROM sessions WHERE token = $1 AND expires_at > $2',
      [token, now]
    );
    const userId = rows[0]?.user_id || null;
    if (userId) {
      await getPool()
        .query('UPDATE sessions SET expires_at = $1 WHERE token = $2', [freshUntil, token])
        .catch(() => {});
    }
    return userId;
  }
  const db = readJsonDb();
  const s = db.sessions.find((x) => x.token === token && x.expiresAt > now);
  if (s) {
    s.expiresAt = freshUntil;
    writeJsonDb(db);
    return s.userId;
  }
  return null;
}

async function login(email, password) {
  const found = await findByEmail(email);
  if (!found) return null;
  const check = await security.verifyPassword(found, password);
  if (!check.ok) return null;
  if (check.upgrade) {
    const newHash = await security.hashPassword(password);
    await updatePasswordHash(found.id, newHash);
    found.passwordHash = newHash;
  }
  const token = await createSession(found.id);
  return { token, user: found };
}

async function saveRegistrationPending(email, data) {
  if (pgEnabled()) {
    await getPool().query('DELETE FROM registration_pending WHERE expires_at < $1', [Date.now()]);
    await getPool().query(
      `INSERT INTO registration_pending (email, code, first_name, last_name, full_name, company, phone, job_title, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (email) DO UPDATE SET code=$2, first_name=$3, last_name=$4, full_name=$5, company=$6, phone=$7, job_title=$8, expires_at=$9`,
      [
        email,
        data.code,
        data.firstName,
        data.lastName,
        data.fullName,
        data.company || '',
        data.phone || '',
        data.jobTitle || '',
        data.expiresAt,
      ]
    );
    return;
  }
  const db = readJsonDb();
  db.registrationPending = db.registrationPending || {};
  Object.keys(db.registrationPending).forEach((k) => {
    if ((db.registrationPending[k].expiresAt || 0) < Date.now()) delete db.registrationPending[k];
  });
  db.registrationPending[email] = data;
  writeJsonDb(db);
}

async function getRegistrationPending(email) {
  if (pgEnabled()) {
    const { rows } = await getPool().query('SELECT * FROM registration_pending WHERE email = $1', [email]);
    const r = rows[0];
    if (!r) return null;
    return {
      code: r.code,
      firstName: r.first_name,
      lastName: r.last_name,
      fullName: r.full_name,
      company: r.company || '',
      phone: r.phone || '',
      jobTitle: r.job_title || '',
      expiresAt: Number(r.expires_at),
    };
  }
  const db = readJsonDb();
  return db.registrationPending?.[email] || null;
}

async function savePasswordResetPending(email, data) {
  if (pgEnabled()) {
    await getPool().query('DELETE FROM password_reset_pending WHERE expires_at < $1', [Date.now()]);
    await getPool().query(
      `INSERT INTO password_reset_pending (email, code, expires_at) VALUES ($1,$2,$3)
       ON CONFLICT (email) DO UPDATE SET code=$2, expires_at=$3`,
      [email, data.code, data.expiresAt]
    );
    return;
  }
  const db = readJsonDb();
  db.passwordResetPending = db.passwordResetPending || {};
  Object.keys(db.passwordResetPending).forEach((k) => {
    if ((db.passwordResetPending[k].expiresAt || 0) < Date.now()) delete db.passwordResetPending[k];
  });
  db.passwordResetPending[email] = data;
  writeJsonDb(db);
}

async function getPasswordResetPending(email) {
  if (pgEnabled()) {
    const { rows } = await getPool().query('SELECT * FROM password_reset_pending WHERE email = $1', [email]);
    const r = rows[0];
    if (!r) return null;
    return { code: r.code, expiresAt: Number(r.expires_at) };
  }
  const db = readJsonDb();
  return db.passwordResetPending?.[email] || null;
}

async function deletePasswordResetPending(email) {
  if (pgEnabled()) {
    await getPool().query('DELETE FROM password_reset_pending WHERE email = $1', [email]);
    return;
  }
  const db = readJsonDb();
  if (db.passwordResetPending) delete db.passwordResetPending[email];
  writeJsonDb(db);
}

async function resetPasswordByEmail(email, newPassword) {
  const found = await findByEmail(email);
  if (!found) return null;
  const hash = await security.hashPassword(newPassword);
  await updatePasswordHash(found.id, hash);
  return found;
}

async function deleteRegistrationPending(email) {
  if (pgEnabled()) {
    await getPool().query('DELETE FROM registration_pending WHERE email = $1', [email]);
    return;
  }
  const db = readJsonDb();
  if (db.registrationPending) delete db.registrationPending[email];
  writeJsonDb(db);
}

async function createUser({
  id,
  email,
  password,
  role,
  firstName,
  lastName,
  notifyEmail,
  status,
  company,
  phone,
  jobTitle,
  contractorId,
  objectIds,
}) {
  const passwordHash = await security.hashPassword(password);
  const record = {
    id,
    email: email.toLowerCase(),
    passwordHash,
    role: role || 'viewer',
    firstName,
    lastName,
    notifyEmail: notifyEmail || SYSTEM_NOTIFY_EMAIL,
    notificationSettings: {},
    status: status || (String(role || 'viewer').toLowerCase() === 'viewer' ? 'pending' : 'active'),
    company: company || '',
    phone: phone || '',
    jobTitle: jobTitle || '',
    contractorId: contractorId || null,
    objectIds: normalizeObjectIds(objectIds),
  };
  if (pgEnabled()) {
    await getPool().query(
      `INSERT INTO users (id, email, password_hash, role, first_name, last_name, notify_email, status, company, phone, job_title, contractor_id, object_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        record.email,
        passwordHash,
        record.role,
        firstName,
        lastName,
        record.notifyEmail,
        record.status,
        record.company,
        record.phone,
        record.jobTitle,
        record.contractorId,
        JSON.stringify(record.objectIds),
      ]
    );
    return jsonUserToRecord(record);
  }
  const db = readJsonDb();
  const nu = {
    id,
    email: record.email,
    passwordHash,
    role: record.role,
    firstName,
    lastName,
    notifyEmail: record.notifyEmail,
    status: record.status,
    company: record.company,
    phone: record.phone,
    jobTitle: record.jobTitle,
    contractorId: record.contractorId,
    objectIds: record.objectIds,
  };
  db.users.push(nu);
  writeJsonDb(db);
  return jsonUserToRecord(nu);
}

async function updateUser(id, patch) {
  const u = await getUserById(id);
  if (!u) return null;
  if (pgEnabled()) {
    const fields = [];
    const vals = [];
    let i = 1;
    const map = {
      email: 'email',
      notifyEmail: 'notify_email',
      notificationSettings: 'notification_settings',
      googleRefreshToken: 'google_refresh_token',
      googleAccessToken: 'google_access_token',
      googleEmail: 'google_email',
      telegramChatId: 'telegram_chat_id',
      role: 'role',
      firstName: 'first_name',
      lastName: 'last_name',
      contractorId: 'contractor_id',
      objectIds: 'object_ids',
      avatarUrl: 'avatar_url',
      status: 'status',
      company: 'company',
      phone: 'phone',
      jobTitle: 'job_title',
      approvalRequestedAt: 'approval_requested_at',
      tutorialCompleted: 'tutorial_completed',
    };
    Object.keys(patch).forEach((key) => {
      if (patch[key] === undefined) return;
      const col = map[key];
      if (!col) return;
      fields.push(`${col} = $${i++}`);
      vals.push(
        key === 'notificationSettings'
          ? JSON.stringify(patch[key])
          : key === 'objectIds'
            ? JSON.stringify(normalizeObjectIds(patch[key]))
            : key === 'email'
              ? String(patch[key]).trim().toLowerCase()
              : key === 'tutorialCompleted'
                ? !!patch[key]
                : patch[key]
      );
    });
    if (fields.length) {
      vals.push(id);
      await getPool().query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${i}`, vals);
    }
    return getUserById(id);
  }
  const db = readJsonDb();
  const row = db.users.find((x) => x.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  writeJsonDb(db);
  return jsonUserToRecord(row);
}

async function clearGoogleTokens(id) {
  return updateUser(id, {
    googleRefreshToken: null,
    googleAccessToken: null,
  });
}

async function listUsers() {
  if (pgEnabled()) {
    const { rows } = await getPool().query(
      'SELECT id, email, role, first_name, last_name, notify_email, status, company, phone, job_title, contractor_id, object_ids, avatar_url, created_at FROM users ORDER BY LOWER(email)'
    );
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role,
      firstName: r.first_name,
      lastName: r.last_name,
      name: `${r.first_name} ${r.last_name}`.trim(),
      notifyEmail: r.notify_email || '',
      status: r.status || 'active',
      company: r.company || '',
      phone: r.phone || '',
      jobTitle: r.job_title || '',
      contractorId: r.contractor_id || null,
      objectIds: normalizeObjectIds(r.object_ids),
      avatarUrl: r.avatar_url || null,
      createdAt: r.created_at,
    }));
  }
  const db = readJsonDb();
  return db.users
    .map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      firstName: u.firstName,
      lastName: u.lastName,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
      notifyEmail: u.notifyEmail || '',
      status: u.status || 'active',
      company: u.company || '',
      phone: u.phone || '',
      jobTitle: u.jobTitle || u.job_title || '',
      contractorId: u.contractorId || null,
      objectIds: normalizeObjectIds(u.objectIds),
      avatarUrl: u.avatarUrl || u.avatar_url || null,
      createdAt: u.createdAt || null,
    }))
    .sort((a, b) => (a.email || '').localeCompare(b.email || '', 'ru'));
}

async function deleteUser(id) {
  if (pgEnabled()) {
    const r = await getPool().query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
    return r.rowCount > 0;
  }
  const db = readJsonDb();
  const idx = db.users.findIndex((x) => x.id === id);
  if (idx < 0) return false;
  db.users.splice(idx, 1);
  db.sessions = db.sessions.filter((s) => s.userId !== id);
  writeJsonDb(db);
  return true;
}

async function ensureAdminUser({
  email = 'admin@victory-check.ru',
  password = 'VictoryAdmin2026!',
  firstName = 'Victory',
  lastName = 'Admin',
} = {}) {
  const e = String(email).trim().toLowerCase();
  const existing = await findByEmail(e);
  const mustReset =
    !existing ||
    !security.isSecureHash(existing.passwordHash) ||
    !!process.env.VC_ADMIN_PASSWORD ||
    process.env.VC_FORCE_ADMIN_PASSWORD === 'true';
  if (existing) {
    if (mustReset) {
      const hash = await security.hashPassword(password);
      await updatePasswordHash(existing.id, hash);
    }
    return { created: false, email: e, password: mustReset ? password : null };
  }
  const id = 'admin-' + crypto.randomBytes(6).toString('hex');
  await createUser({
    id,
    email: e,
    password,
    role: 'admin',
    firstName,
    lastName,
    notifyEmail: e,
    status: 'active',
  });
  return { created: true, email: e, password };
}

module.exports = {
  init,
  pgEnabled,
  getPool,
  getUserById,
  findByEmail,
  emailExists,
  createSession,
  getUserIdByToken,
  login,
  saveRegistrationPending,
  getRegistrationPending,
  deleteRegistrationPending,
  savePasswordResetPending,
  getPasswordResetPending,
  deletePasswordResetPending,
  resetPasswordByEmail,
  createUser,
  updateUser,
  clearGoogleTokens,
  listUsers,
  listRegistrationPending,
  deleteUser,
  ensureAdminUser,
};
