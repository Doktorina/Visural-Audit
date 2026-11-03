/**
 * Объекты, подрядчики, нарушения, уведомления — PostgreSQL или db.json (fallback)
 */
const fs = require('fs');
const path = require('path');
const categoriesLib = require('./categories-lib');

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const SEED_PATH = path.join(__dirname, 'data', 'seed.json');
const DATA_SCHEMA_PATH = path.join(__dirname, 'db', 'data-schema.sql');

let pool = null;
let usePg = false;

function pgEnabled() {
  return usePg && !!pool;
}

function attachPool(pgPool) {
  pool = pgPool;
  usePg = !!pgPool;
}

function readJsonFile() {
  try {
    if (!fs.existsSync(DB_PATH)) return null;
    const raw = fs.readFileSync(DB_PATH, 'utf8').trim();
    if (!raw) return null;
    const db = JSON.parse(raw);
    if (!Array.isArray(db.objects)) db.objects = [];
    if (!Array.isArray(db.contractors)) db.contractors = [];
    if (!Array.isArray(db.violations)) db.violations = [];
    if (!Array.isArray(db.notifications)) db.notifications = [];
    if (!db.seq) db.seq = {};
    if (!Array.isArray(db.telegramChats)) db.telegramChats = [];
    if (!Array.isArray(db.categories)) db.categories = [];
    return db;
  } catch {
    return null;
  }
}

function writeJsonFile(db) {
  const existing = readJsonFile() || {};
  const out = {
    ...existing,
    users: Array.isArray(existing.users) ? existing.users : [],
    sessions: Array.isArray(existing.sessions) ? existing.sessions : [],
    registrationPending:
      existing.registrationPending && typeof existing.registrationPending === 'object'
        ? existing.registrationPending
        : {},
    passwordResetPending:
      existing.passwordResetPending && typeof existing.passwordResetPending === 'object'
        ? existing.passwordResetPending
        : {},
    objects: db.objects ?? existing.objects ?? [],
    contractors: db.contractors ?? existing.contractors ?? [],
    violations: db.violations ?? existing.violations ?? [],
    notifications: db.notifications ?? existing.notifications ?? [],
    seq: db.seq ?? existing.seq ?? {},
    telegramChats: db.telegramChats ?? existing.telegramChats ?? [],
    categories: db.categories ?? existing.categories ?? [],
  };
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(out, null, 2), 'utf8');
}

function rowToViolation(row) {
  return {
    id: row.id,
    number: row.number,
    objectId: row.object_id,
    contractorId: row.contractor_id,
    categoryId: row.category_id,
    categoryOther: row.category_other || '',
    severity: row.severity,
    description: row.description,
    status: row.status,
    deadline: row.deadline ? new Date(row.deadline).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    responsible: row.responsible || '',
    media: row.media || [],
    reportMedia: row.report_media || [],
    history: row.history || [],
    comments: row.comments || [],
    normRefs: row.norm_refs || [],
    locationGps: row.location_gps || null,
    deadlineApproachingNotified: !!row.deadline_approaching_notified,
    deadlineExpiredNotified: !!row.deadline_expired_notified,
  };
}

function rowToNotification(row) {
  let p = row.payload || {};
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p || '{}');
    } catch (_) {
      p = {};
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    violationId: row.violation_id,
    channel: row.channel,
    type: row.type,
    title: row.title,
    message: row.message,
    body: row.body,
    telegramRecipients: row.telegram_recipients || p.telegramRecipients,
    telegramSent: row.telegram_sent ?? p.telegramSent,
    deliveryStatus: row.delivery_status || p.deliveryStatus,
    isRead: row.is_read,
    read: row.is_read,
    actionLabel: p.actionLabel || null,
    subject: p.subject || null,
    payload: p,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    at: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function notificationToRow(n) {
  const basePayload =
    n.payload && typeof n.payload === 'object' && !Array.isArray(n.payload) ? { ...n.payload } : {};
  const payload = {
    ...basePayload,
    actionLabel: n.actionLabel ?? basePayload.actionLabel,
    subject: n.subject ?? basePayload.subject,
    telegramRecipients: n.telegramRecipients ?? basePayload.telegramRecipients,
    telegramSent: n.telegramSent ?? basePayload.telegramSent,
    deliveryStatus: n.deliveryStatus ?? basePayload.deliveryStatus,
    userId: basePayload.userId ?? n.payload?.userId ?? null,
    email: basePayload.email ?? n.payload?.email ?? null,
  };
  return {
    id: n.id,
    user_id: n.userId || null,
    violation_id: n.violationId || null,
    channel: n.channel || 'push',
    type: n.type || '',
    title: n.title || '',
    message: n.message || '',
    body: n.body || '',
    telegram_recipients: n.telegramRecipients ? JSON.stringify(n.telegramRecipients) : null,
    telegram_sent: n.telegramSent ?? null,
    delivery_status: n.deliveryStatus || null,
    is_read: !!(n.isRead || n.read),
    payload: JSON.stringify(payload),
    created_at: n.createdAt || n.at || new Date().toISOString(),
  };
}

async function readDbPg() {
  const [objs, cons, viols, notifs, seqRows, chats, cats] = await Promise.all([
    pool.query('SELECT id, name, code, address FROM objects ORDER BY name'),
    pool.query('SELECT id, name, type, inn, executor, email FROM contractors ORDER BY name'),
    pool.query('SELECT * FROM violations ORDER BY created_at DESC'),
    pool.query('SELECT * FROM notifications ORDER BY created_at DESC'),
    pool.query('SELECT key, value FROM seq_counters'),
    pool.query('SELECT chat_id FROM telegram_chats ORDER BY linked_at'),
    pool.query('SELECT id, name, icon, sort_order FROM violation_categories ORDER BY sort_order, name'),
  ]);
  const seq = {};
  seqRows.rows.forEach((r) => {
    seq[r.key] = Number(r.value);
  });
  return {
    users: [],
    objects: objs.rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      address: r.address || '',
    })),
    contractors: cons.rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type || 'ooo',
      inn: r.inn || '',
      executor: r.executor || '',
      email: r.email || '',
    })),
    violations: viols.rows.map(rowToViolation),
    notifications: notifs.rows.map(rowToNotification),
    seq,
    telegramChats: chats.rows.map((r) => r.chat_id),
    categories: cats.rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon || '📋',
      sortOrder: Number(r.sort_order) || 0,
    })),
    sessions: [],
    registrationPending: {},
  };
}

async function writeDbPg(db) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const objIds = (db.objects || []).map((o) => o.id);
    const conIds = (db.contractors || []).map((c) => c.id);
    const violIds = (db.violations || []).map((v) => v.id);

    if (objIds.length) {
      await client.query('DELETE FROM objects WHERE NOT (id = ANY($1::varchar[]))', [objIds]);
    } else {
      await client.query('DELETE FROM objects');
    }
    for (const o of db.objects || []) {
      await client.query(
        `INSERT INTO objects (id, name, code, address) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name=$2, code=$3, address=$4`,
        [o.id, o.name, o.code, o.address || '']
      );
    }

    if (conIds.length) {
      await client.query('DELETE FROM contractors WHERE NOT (id = ANY($1::varchar[]))', [conIds]);
    } else {
      await client.query('DELETE FROM contractors');
    }
    for (const c of db.contractors || []) {
      await client.query(
        `INSERT INTO contractors (id, name, type, inn, executor, email) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name=$2, type=$3, inn=$4, executor=$5, email=$6`,
        [c.id, c.name, c.type || 'ooo', c.inn || '', c.executor || '', c.email || '']
      );
    }

    if (violIds.length) {
      await client.query('DELETE FROM violations WHERE NOT (id = ANY($1::varchar[]))', [violIds]);
    } else {
      await client.query('DELETE FROM violations');
    }
    for (const v of db.violations || []) {
      await client.query(
        `INSERT INTO violations (
          id, number, object_id, contractor_id, category_id, category_other, severity, description, status,
          deadline, created_at, updated_at, responsible, media, history, comments, norm_refs, location_gps,
          deadline_approaching_notified, deadline_expired_notified, report_media
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        ON CONFLICT (id) DO UPDATE SET
          number=$2, object_id=$3, contractor_id=$4, category_id=$5, category_other=$6, severity=$7, description=$8,
          status=$9, deadline=$10, updated_at=$12, responsible=$13, media=$14, history=$15,
          comments=$16, norm_refs=$17, location_gps=$18,
          deadline_approaching_notified=$19, deadline_expired_notified=$20, report_media=$21`,
        [
          v.id,
          v.number,
          v.objectId,
          v.contractorId,
          v.categoryId,
          v.categoryOther || '',
          v.severity,
          v.description || '',
          v.status,
          v.deadline ? new Date(v.deadline) : null,
          v.createdAt ? new Date(v.createdAt) : new Date(),
          v.updatedAt ? new Date(v.updatedAt) : null,
          v.responsible || '',
          JSON.stringify(v.media || []),
          JSON.stringify(v.history || []),
          JSON.stringify(v.comments || []),
          JSON.stringify(v.normRefs || []),
          v.locationGps ? JSON.stringify(v.locationGps) : null,
          !!v.deadlineApproachingNotified,
          !!v.deadlineExpiredNotified,
          JSON.stringify(v.reportMedia || []),
        ]
      );
    }

    const catIds = (db.categories || []).map((c) => c.id);
    if (catIds.length) {
      await client.query('DELETE FROM violation_categories WHERE NOT (id = ANY($1::varchar[]))', [catIds]);
    } else {
      await client.query('DELETE FROM violation_categories');
    }
    for (const c of db.categories || []) {
      await client.query(
        `INSERT INTO violation_categories (id, name, icon, sort_order) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name=$2, icon=$3, sort_order=$4`,
        [c.id, c.name, c.icon || '📋', Number(c.sortOrder) || 0]
      );
    }

    const notifIds = (db.notifications || []).map((n) => n.id);
    if (notifIds.length) {
      await client.query('DELETE FROM notifications WHERE NOT (id = ANY($1::varchar[]))', [notifIds]);
    } else {
      await client.query('DELETE FROM notifications');
    }
    for (const n of db.notifications || []) {
      const r = notificationToRow(n);
      await client.query(
        `INSERT INTO notifications (
          id, user_id, violation_id, channel, type, title, message, body,
          telegram_recipients, telegram_sent, delivery_status, is_read, payload, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (id) DO UPDATE SET
          user_id=$2, violation_id=$3, channel=$4, type=$5, title=$6, message=$7, body=$8,
          telegram_recipients=$9, telegram_sent=$10, delivery_status=$11, is_read=$12, payload=$13`,
        [
          r.id,
          r.user_id,
          r.violation_id,
          r.channel,
          r.type,
          r.title,
          r.message,
          r.body,
          r.telegram_recipients,
          r.telegram_sent,
          r.delivery_status,
          r.is_read,
          r.payload,
          r.created_at,
        ]
      );
    }

    for (const [key, val] of Object.entries(db.seq || {})) {
      await client.query(
        `INSERT INTO seq_counters (key, value) VALUES ($1,$2)
         ON CONFLICT (key) DO UPDATE SET value=$2`,
        [key, Number(val) || 0]
      );
    }

    await client.query('DELETE FROM telegram_chats');
    for (const chatId of db.telegramChats || []) {
      await client.query('INSERT INTO telegram_chats (chat_id) VALUES ($1) ON CONFLICT DO NOTHING', [
        String(chatId),
      ]);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

function seedFromFile() {
  return {
    users: [],
    objects: [],
    contractors: [],
    violations: [],
    notifications: [],
    seq: {},
    telegramChats: [],
    sessions: [],
    registrationPending: {},
    passwordResetPending: {},
  };
}

async function migrateFromJsonIfEmpty() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM objects');
  if (rows[0].c > 0) return;
  const json = readJsonFile();
  const base = json || seedFromFile();
  if (!base.objects.length && !base.contractors.length && !base.violations.length) {
    const seed = seedFromFile();
    Object.assign(base, seed);
  }
  const count =
    (base.objects?.length || 0) + (base.contractors?.length || 0) + (base.violations?.length || 0);
  if (!count) return;
  console.log(`PostgreSQL: импорт данных из db.json (${base.violations.length} нарушений)…`);
  await writeDbPg(base);
}

async function seedDefaultCategoriesPg() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM violation_categories');
  if (rows[0].c > 0) return;
  for (const c of categoriesLib.DEFAULT_CATEGORIES) {
    await pool.query(
      `INSERT INTO violation_categories (id, name, icon, sort_order) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [c.id, c.name, c.icon, c.sortOrder || 0]
    );
  }
}

async function init(pgPool) {
  if (!pgPool) {
    console.log('  БД данных: db.json (задайте DATABASE_URL для PostgreSQL)');
    usePg = false;
    if (!fs.existsSync(DB_PATH) && fs.existsSync(SEED_PATH)) {
      const seed = seedFromFile();
      seed.categories = categoriesLib.DEFAULT_CATEGORIES.map((c) => ({ ...c }));
      writeJsonFile(seed);
    }
    return;
  }
  attachPool(pgPool);
  const sql = fs.readFileSync(DATA_SCHEMA_PATH, 'utf8');
  await pool.query(sql);
  await pool
    .query("ALTER TABLE violations ADD COLUMN IF NOT EXISTS category_other TEXT NOT NULL DEFAULT ''")
    .catch(() => {});
  await pool
    .query(
      'ALTER TABLE violations ADD COLUMN IF NOT EXISTS deadline_approaching_notified BOOLEAN NOT NULL DEFAULT false'
    )
    .catch(() => {});
  await pool
    .query(
      'ALTER TABLE violations ADD COLUMN IF NOT EXISTS deadline_expired_notified BOOLEAN NOT NULL DEFAULT false'
    )
    .catch(() => {});
  await pool
    .query(
      `UPDATE violations SET deadline_approaching_notified = true
       WHERE deadline_approaching_notified = false
         AND history::text LIKE '%осталось менее 2 суток — отправлено уведомление%'`
    )
    .catch(() => {});
  await pool
    .query(
      `UPDATE violations SET deadline_expired_notified = true
       WHERE deadline_expired_notified = false
         AND history::text LIKE '%Срок устранения истёк — отправлено уведомление%'`
    )
    .catch(() => {});
  await pool
    .query("ALTER TABLE violations ADD COLUMN IF NOT EXISTS report_media JSONB NOT NULL DEFAULT '[]'")
    .catch(() => {});
  await seedDefaultCategoriesPg();
  await migrateFromJsonIfEmpty();
  console.log('  БД данных: PostgreSQL');
}

function hydrateReportMedia(v) {
  if (!v) return v;
  const fromField = Array.isArray(v.reportMedia) ? v.reportMedia.filter(Boolean) : [];
  if (fromField.length) {
    v.reportMedia = fromField;
    return v;
  }
  const fromComments = [];
  for (const c of v.comments || []) {
    if (c?.type !== 'report') continue;
    for (const m of c.media || []) {
      if (m) fromComments.push(m);
    }
  }
  v.reportMedia = fromComments;
  return v;
}

async function readDb() {
  if (pgEnabled()) {
    const db = await readDbPg();
    if (!db.categories.length) db.categories = categoriesLib.DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    (db.violations || []).forEach(hydrateReportMedia);
    return db;
  }
  const db = readJsonFile();
  if (db) {
    categoriesLib.ensureCategories(db);
    (db.violations || []).forEach(hydrateReportMedia);
    return db;
  }
  const seed = seedFromFile();
  seed.categories = categoriesLib.DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  writeJsonFile(seed);
  return seed;
}

async function writeDb(db) {
  if (pgEnabled()) return writeDbPg(db);
  writeJsonFile(db);
}

module.exports = {
  init,
  pgEnabled,
  attachPool,
  readDb,
  writeDb,
};
