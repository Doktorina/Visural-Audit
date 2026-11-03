/**
 * Victory Check API + раздача mobile (/mobile) и admin (/admin)
 * Запуск: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { URL } = require('url');
const apkAutoPublish = require('./apk-auto-publish');
const templates = require('./templates');
const notifConfig = require('./notification-config');
const mailer = require('./mailer');
const googleMail = require('./google-mail');
const telegram = require('./telegram');
const permissions = require('./permissions');
const usersStore = require('./users-store');
const dataStore = require('./data-store');
const analyticsLib = require('./analytics-lib');
const mediaStore = require('./media-store');
const projectScope = require('./project-scope');
const violationCritical = require('./violation-critical');

function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
}
loadEnvFile();

const PORT = Number(process.env.PORT) || 4000;
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT) || PORT;
const PUBLIC_HOST = process.env.PUBLIC_HOST || '';
const ROOT = path.join(__dirname, '..');

function publicBaseUrl(host) {
  const h = host || PUBLIC_HOST || '';
  if (!h) return null;
  if (process.env.PUBLIC_SCHEME) {
    const portPart = PUBLIC_PORT === 80 || PUBLIC_PORT === 443 ? '' : `:${PUBLIC_PORT}`;
    return `${process.env.PUBLIC_SCHEME}://${h}${portPart}`;
  }
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(h);
  const scheme = PUBLIC_PORT === 443 || (!isIp && PUBLIC_PORT === 80) ? 'https' : 'http';
  const portPart = PUBLIC_PORT === 80 || PUBLIC_PORT === 443 ? '' : `:${PUBLIC_PORT}`;
  return `${scheme}://${h}${portPart}`;
}
const SEED_PATH = path.join(__dirname, 'data', 'seed.json');
const SECRET = process.env.VC_SECRET || 'victory-check-dev-secret';
const DEFAULT_NOTIFY_EMAIL = (process.env.DEFAULT_NOTIFY_EMAIL || process.env.SMTP_USER || '').trim();
/** Временный режим одного получателя включается только при VC_USE_NORMAL_RECIPIENTS=false. */
const TEMP_EMAIL_RECIPIENT = (
  process.env.VC_TEMP_EMAIL_RECIPIENT || DEFAULT_NOTIFY_EMAIL
)
  .trim()
  .toLowerCase();
const USE_TEMP_EMAIL_RECIPIENT = process.env.VC_USE_NORMAL_RECIPIENTS === 'false';
const LEGACY_NOTIFY_BLOCK = new Set(
  (process.env.BLOCK_NOTIFY_EMAILS || '')
    .split(/[,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function isBlockedNotifyEmail(email) {
  return LEGACY_NOTIFY_BLOCK.has(String(email || '').trim().toLowerCase());
}

function isDeliverableNotifyEmail(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr.includes('@') || isBlockedNotifyEmail(addr)) return false;
  if (mailer.isPlaceholderEmail(addr)) return false;
  return true;
}

function normalizeSystemNotifyRecipients(list) {
  const out = new Set();
  const primary = DEFAULT_NOTIFY_EMAIL.toLowerCase();
  if (isDeliverableNotifyEmail(primary)) out.add(primary);
  (list || []).forEach((e) => {
    const addr = String(e || '').trim().toLowerCase();
    if (!isDeliverableNotifyEmail(addr)) return;
    out.add(addr);
  });
  return [...out];
}

const categoriesLib = require('./categories-lib');

const SEVERITY_HOURS = { major: 24, minor: 72, recommendation: 168 };
const STATUS_LABELS = {
  new: 'Новое',
  in_progress: 'В работе',
  verification: 'На проверке',
  resolved: 'Устранено',
  overdue: 'Просрочено',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
};

function readApkVersionInfo() {
  const jsonPath = path.join(ROOT, 'victory-check-mobile', 'apk-version.json');
  try {
    const info = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const apkPath = resolveApkFile();
    if (apkPath) {
      try {
        const st = fs.statSync(apkPath);
        info.builtAt = st.mtime.toISOString();
        info.sizeBytes = st.size;
      } catch (_) {}
    }
    return info;
  } catch {
    return { version: '1.2.4', versionCode: 13, file: 'VisuralAudit.apk', label: 'Visural Audit' };
  }
}

function resolveApkFile() {
  const candidates = [
    path.join(ROOT, 'victory-check-mobile', 'VisuralAudit.apk'),
    path.join(ROOT, 'victory-check-apk', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    path.join(ROOT, 'victory-check-apk', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'),
    path.join(ROOT, 'victory-check-mobile', 'VisuralCheck.apk'),
  ];
  let best = null;
  let bestMtime = 0;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const mtime = fs.statSync(p).mtimeMs;
      if (mtime >= bestMtime) {
        bestMtime = mtime;
        best = p;
      }
    } catch (_) {}
  }
  return best;
}

function apkDownloadUrl(info, apkPath) {
  if (!apkPath) return null;
  const v = encodeURIComponent(info.version || 'latest');
  let t = '';
  try {
    t = String(fs.statSync(apkPath).mtimeMs);
  } catch (_) {}
  return `/api/mobile/apk?v=${v}${t ? `&t=${t}` : ''}`;
}

function serveApkDownload(res, filePath) {
  const info = readApkVersionInfo();
  const ver = info.version || 'latest';
  fs.stat(filePath, (statErr, st) => {
    if (statErr) {
      res.writeHead(404);
      res.end('APK not found');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('APK not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': `attachment; filename="VisuralAudit-${ver}.apk"`,
        'Content-Length': data.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Pragma': 'no-cache',
        'Last-Modified': st.mtime.toUTCString(),
        'ETag': `"${st.mtimeMs}-${st.size}"`,
      });
      res.end(data);
    });
  });
}

/** Реальный Wi-Fi/LAN IP (без VPN-адаптеров вроде Meta/Clash 198.18.x) */
function getLanIp() {
  const candidates = [];
  try {
    for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
      for (const net of ifaces || []) {
        const fam = net.family;
        if (fam !== 'IPv4' && fam !== 4) continue;
        if (net.internal) continue;
        const ip = String(net.address || '');
        if (!ip || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
        const p = ip.split('.').map(Number);
        const isVpn = p[0] === 198 && p[1] >= 18 && p[1] <= 19;
        if (isVpn) continue;
        const isPrivate =
          p[0] === 10 ||
          (p[0] === 192 && p[1] === 168) ||
          (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
        candidates.push({ ip, name, isPrivate });
      }
    }
  } catch (_) {}
  const priv = candidates.filter((c) => c.isPrivate);
  const pool = priv.length ? priv : candidates;
  const wifi = pool.find((c) => /wi-?fi|wlan|беспровод|wireless/i.test(c.name));
  if (wifi) return wifi.ip;
  const ten = pool.find((c) => c.ip.startsWith('10.'));
  if (ten) return ten.ip;
  return pool[0]?.ip || '';
}

function readDb() {
  return dataStore.readDb();
}

function writeDb(db) {
  return dataStore.writeDb(db);
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function calcDeadline(severityId, from = new Date()) {
  const h = SEVERITY_HOURS[severityId] ?? 24;
  const d = new Date(from);
  if (h > 0) d.setHours(d.getHours() + h);
  return d;
}

function isOverdue(v) {
  if (v.status === 'resolved' || v.status === 'verification') return false;
  return new Date(v.deadline) < new Date();
}

function applyOverdue(v) {
  if (isOverdue(v) && v.status !== 'resolved' && v.status !== 'verification') {
    return { ...v, status: 'overdue' };
  }
  return v;
}

function nextNumber(db, objectCode) {
  const year = new Date().getFullYear();
  const key = objectCode || 'OBJ';
  db.seq[key] = (db.seq[key] || 0) + 1;
  return `${key}/${year}/${String(db.seq[key]).padStart(5, '0')}`;
}

const EMAIL_SYNC_TIMEOUT_MS = Number(process.env.VC_EMAIL_SYNC_TIMEOUT_MS) || 25000;

function fireAndForget(promise, label) {
  Promise.resolve(promise).catch((e) => {
    console.error(label || 'background task:', e?.message || e);
  });
}

async function resolveSessionUser(token) {
  if (!token) return null;
  const userId = await usersStore.getUserIdByToken(token);
  if (!userId) return null;
  const raw = await usersStore.getUserById(userId);
  return raw ? sanitizeUser(raw) : null;
}

function sanitizeUser(u) {
  const name = `${u.firstName} ${u.lastName}`;
  const roleKey = notifConfig.resolveRoleKey(u.role);
  const role = permissions.normalizeRole(u.role);
  const status = String(u.status || 'active').toLowerCase();
  return {
    id: u.id,
    email: u.email,
    name,
    firstName: u.firstName || '',
    lastName: u.lastName || '',
    initials: (u.firstName[0] + (u.lastName[0] || '')).toUpperCase(),
    role,
    roleKey,
    roleLabel: permissions.ROLE_LABELS[role] || role,
    status,
    company: u.company || '',
    phone: u.phone || '',
    jobTitle: u.jobTitle || '',
    approvalRequestedAt: u.approvalRequestedAt || null,
    contractorId: u.contractorId || null,
    objectIds: projectScope.normalizeObjectIds(u.objectIds),
    permissions: permissions.getPermissions(role, status),
    notifyEmail: u.notifyEmail || DEFAULT_NOTIFY_EMAIL,
    googleConnected: !!(u.googleRefreshToken),
    telegramConnected: !!(u.telegramChatId),
    notificationSettings: notifConfig.mergeSettings(u.notificationSettings),
    avatarUrl: u.avatarUrl || null,
    tutorialCompleted: !!u.tutorialCompleted,
  };
}

const ALLOWED_ROLES = ['admin', 'auditor', 'contractor', 'viewer'];

function formatAdminUser(u) {
  return {
    id: u.id,
    email: u.email,
    role: permissions.normalizeRole(u.role),
    status: String(u.status || 'active').toLowerCase(),
    firstName: u.firstName,
    lastName: u.lastName,
    name: `${u.firstName} ${u.lastName}`.trim(),
    company: u.company || '',
    phone: u.phone || '',
    jobTitle: u.jobTitle || '',
    contractorId: u.contractorId || null,
    objectIds: projectScope.normalizeObjectIds(u.objectIds),
    notifyEmail: u.notifyEmail || DEFAULT_NOTIFY_EMAIL,
    avatarUrl: u.avatarUrl || null,
    createdAt: u.createdAt,
  };
}

function validateAvatarUrl(url) {
  if (url === null || url === '') return null;
  const s = String(url);
  if (!s.startsWith('data:image/')) {
    throw new Error('Недопустимый формат аватара');
  }
  if (s.length > 350000) throw new Error('Файл аватара слишком большой');
  return s;
}

function dbUser(user) {
  if (!user) return null;
  return {
    ...user,
    status: user.status || 'active',
  };
}

async function autoLinkUserToContractor(db, userId, company) {
  const contractor = projectScope.findContractorByCompanyName(db, company);
  if (!contractor) return null;
  const updated = await usersStore.updateUser(userId, {
    contractorId: contractor.id,
    company: contractor.name,
  });
  return updated;
}

async function notifyAdminsAboutUser(db, nu, { type, title, message }) {
  const admins = (await usersStore.listUsers()).filter(
    (a) => permissions.normalizeRole(a.role) === 'admin'
  );
  if (!admins.length) return;
  db.notifications = db.notifications || [];
  const stamp = Date.now();
  const fullName = `${nu.firstName || ''} ${nu.lastName || ''}`.trim() || nu.email;
  for (const a of admins) {
    db.notifications.unshift({
      id: `adm${stamp}${Math.random().toString(36).slice(2, 7)}`,
      userId: a.id,
      channel: 'admin',
      type,
      title,
      message: message || `${fullName} · ${nu.company || '—'}`,
      body: `ФИО: ${fullName}\nEmail: ${nu.email}\nКомпания: ${nu.company || '—'}\nТелефон: ${nu.phone || '—'}`,
      isRead: false,
      read: false,
      payload: { userId: nu.id, email: nu.email },
      createdAt: new Date().toISOString(),
      at: new Date().toISOString(),
    });
  }
}

async function notifyAdminsNewUser(db, nu) {
  await notifyAdminsAboutUser(db, nu, {
    type: 'user_pending',
    title: '👤 Новый пользователь',
    message: `${nu.firstName} ${nu.lastName} · ${nu.company || '—'} — зарегистрировался`,
  });
}

async function notifyAdminsApprovalRequest(db, nu) {
  await notifyAdminsAboutUser(db, nu, {
    type: 'user_approval_request',
    title: '✋ Запрос подтверждения',
    message: `${nu.firstName} ${nu.lastName} · ${nu.company || '—'} — просит подтвердить доступ`,
  });
}

function accountNeedsApproval(u) {
  if (!u) return false;
  const status = String(u.status || 'active').toLowerCase();
  if (status === 'rejected') return false;
  if (status === 'pending') return true;
  const role = permissions.normalizeRole(u.role);
  return role === 'viewer' && !permissions.getPermissions(role, status).viewAllViolations;
}

function forbid(res, message) {
  return json(res, 403, { error: message || 'Недостаточно прав' });
}

function recordTelegramNotification(db, { violationId, userId, text, title, type, result, recipients }) {
  db.notifications = db.notifications || [];
  const sent = !!(result && result.sent);
  const rcpts = (result && result.recipients) || recipients || [];
  db.notifications.unshift({
    id: 'tg' + Date.now() + Math.random().toString(36).slice(2, 6),
    userId: userId || null,
    violationId,
    channel: 'telegram',
    type: type || 'violation_new',
    title: title ? `💬 ${title}` : '💬 Telegram',
    message: sent
      ? `✓ Отправлено в Telegram (${rcpts.length})`
      : `✗ ${(result && result.message) || 'Не отправлено в Telegram'}`,
    body: text || '',
    telegramRecipients: rcpts,
    telegramSent: sent,
    deliveryStatus: sent ? 'sent' : 'failed',
    isRead: false,
    read: false,
    createdAt: new Date().toISOString(),
    at: new Date().toISOString(),
  });
}

async function sendTelegramForViolation(db, user, v, body, event, linkedUsers) {
  if (!telegram.isConfigured()) {
    return { sent: false, message: 'Telegram-бот не настроен на сервере' };
  }
  const ev = event || 'created';
  if (ev === 'created') {
    const sendTg = body.sendTelegram !== false && body.notifyTelegram !== false;
    if (!sendTg) return null;
  }
  let chatIds = await telegram.resolveChatIds(db, user.id, body || {}, v, linkedUsers);
  if (!chatIds.length) {
    await telegram.pollAndLink();
    chatIds = await telegram.resolveChatIds(await readDb(), user.id, body || {}, v, linkedUsers);
  }
  const ctx = templates.getViolationContext(v, db, categoriesLib.getCategories(db));
  const tg =
    ev === 'report'
      ? templates.buildTelegramResolved(ctx, user.name)
      : templates.buildTelegramNew(ctx);
  if (!chatIds.length) {
    const fail = {
      sent: false,
      message: 'Telegram: откройте бота и нажмите /start (Профиль → Уведомления)',
    };
    recordTelegramNotification(db, {
      violationId: v.id,
      userId: user.id,
      text: tg.text,
      title: tg.title,
      type: tg.type,
      result: fail,
    });
    return fail;
  }
  const result = await telegram.sendViolationNotify(chatIds, tg.text, v.id);
  const photoPaths = mediaStore.getViolationMediaPaths(v.media);
  if (photoPaths.length) {
    await telegram.sendViolationPhotos(chatIds, photoPaths, `№${v.number}`);
  }
  recordTelegramNotification(db, {
    violationId: v.id,
    userId: user.id,
    text: tg.text,
    title: tg.title,
    type: tg.type,
    result,
    recipients: chatIds,
  });
  return result;
}

function normalizeEmails(input) {
  if (!input) return [];
  let arr = input;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) arr = parsed;
      else arr = String(input).split(/[,;]+/);
    } catch {
      arr = String(input).split(/[,;]+/);
    }
  }
  if (!Array.isArray(arr)) arr = [arr];
  return arr
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => isDeliverableNotifyEmail(s));
}

function normalizeExplicitNotifyEmails(input) {
  if (!input) return [];
  let arr = input;
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) arr = parsed;
      else arr = String(input).split(/[,;]+/);
    } catch {
      arr = String(input).split(/[,;]+/);
    }
  }
  if (!Array.isArray(arr)) arr = [arr];
  return arr
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => s.includes('@') && !isBlockedNotifyEmail(s));
}

async function resolveEmailRecipients({ violation, db, body, linkedUsers, creatorUser }) {
  const addCreator = (set) => {
    if (!creatorUser) return;
    const ce = String(creatorUser.notifyEmail || creatorUser.email || '')
      .trim()
      .toLowerCase();
    if (isDeliverableNotifyEmail(ce)) set.add(ce);
  };

  const fromList = normalizeExplicitNotifyEmails(body?.notifyEmails);
  if (fromList.length) {
    const merged = new Set(fromList);
    addCreator(merged);
    // Явно выбранные получатели: не фильтруем по placeholder-доменам,
    // чтобы акт уходил всем, кто выбран в UI. (Кроме явно заблокированных).
    return [...merged].sort();
  }

  const single = normalizeEmails([body?.notifyEmailTo, body?.to].filter(Boolean));
  if (single.length) {
    return normalizeSystemNotifyRecipients(single);
  }

  const emails = new Set();
  const contractor = (db?.contractors || []).find((c) => c.id === violation.contractorId);
  const contractorEmail = String(contractor?.email || '').trim().toLowerCase();
  if (isDeliverableNotifyEmail(contractorEmail)) emails.add(contractorEmail);

  if (violation.responsibleUserId) {
    const resp = await usersStore.getUserById(violation.responsibleUserId);
    const re = String(projectScope.memberContactEmail(resp) || '').trim().toLowerCase();
    if (isDeliverableNotifyEmail(re)) emails.add(re);
  } else if (violation.responsible) {
    const needle = String(violation.responsible).trim().toLowerCase();
    for (const u of linkedUsers || []) {
      const display = projectScope.userDisplayName(u).toLowerCase();
      if (!display || !needle) continue;
      if (display === needle || display.includes(needle) || needle.includes(display)) {
        const re = String(projectScope.memberContactEmail(u) || '').trim().toLowerCase();
        if (isDeliverableNotifyEmail(re)) emails.add(re);
        break;
      }
    }
  }

  if (!emails.size) {
    projectScope.emailsForUsers(linkedUsers).forEach((e) => emails.add(e.toLowerCase()));
  }

  addCreator(emails);

  return normalizeSystemNotifyRecipients([...emails]);
}

async function sendEmailAsUser(userId, { to, recipients, subject, text, attachments }) {
  const u = await usersStore.getUserById(userId);
  let list;
  if (USE_TEMP_EMAIL_RECIPIENT && TEMP_EMAIL_RECIPIENT.includes('@')) {
    list = [TEMP_EMAIL_RECIPIENT];
  } else {
    list = normalizeSystemNotifyRecipients(
      recipients?.length ? recipients : normalizeEmails([to])
    );
  }
  if (!list.length) {
    return { sent: false, message: 'Нет получателей уведомлений', attachmentCount: 0 };
  }

  const googleRefresh = mailer.preferCompanySender()
    ? ''
    : u?.googleRefreshToken || process.env.GOOGLE_REFRESH_TOKEN;
  const attachmentCount = Array.isArray(attachments) ? attachments.length : 0;
  const result = await mailer.sendMailMany({
    recipients: list,
    subject,
    text,
    attachments,
    googleRefreshToken: googleRefresh,
  });
  return {
    ...result,
    attachmentCount,
    hasAct: attachmentCount > 0,
    message: result.sent
      ? `${result.message || 'Письмо отправлено'}${attachmentCount ? ` · вложений: ${attachmentCount}` : ' · без вложений (акт не сформирован)'}`
      : result.message,
  };
}

async function buildViolationEmailAttachments(violation, db, user, actOverrides) {
  const prescriptionDoc = require('./prescription-doc');
  let users = Array.isArray(db.users) ? db.users : [];
  if (!users.length) {
    try {
      const usersStore = require('./users-store');
      users = await usersStore.listUsers();
    } catch (_) {}
  }
  const dbWithUsers = { ...db, users };
  const ctx = templates.getViolationContext(violation, dbWithUsers, categoriesLib.getCategories(db));
  try {
    const { attachments, prescriptionNum } = prescriptionDoc.buildEmailAttachments(violation, dbWithUsers, {
      ...ctx,
      db: dbWithUsers,
      user,
      actOverrides: actOverrides && typeof actOverrides === 'object' ? actOverrides : null,
      createdByName:
        prescriptionDoc.resolveActAuthorName(user, violation) ||
        projectScope.userDisplayName(user),
    });
    violation.prescriptionNumber = prescriptionNum;
    if (!attachments.length) {
      console.warn('Акт-предписание: вложения пустые для', violation.number);
    }
    return { attachments, prescriptionNum, ctx, error: null };
  } catch (e) {
    const msg = e.message || String(e);
    console.error('Акт-предписание:', msg);
    return { attachments: [], prescriptionNum: null, ctx, error: msg };
  }
}

async function sendViolationEmails(userId, { violation, db, user, recipientName, recipients, actOverrides }) {
  const ctx = templates.getViolationContext(violation, db, categoriesLib.getCategories(db));
  const alert = templates.buildEmailAlert(ctx, recipientName || violation.responsible);
  const { attachments, prescriptionNum, error: actError } = await buildViolationEmailAttachments(
    violation,
    db,
    user,
    actOverrides
  );
  const act = templates.buildEmailAct(ctx, prescriptionNum);

  const notifyResult = await sendEmailAsUser(userId, {
    recipients,
    subject: alert.subject,
    text: alert.body,
    attachments: [],
  });

  let actResult = { sent: false, message: actError ? `Акт не сформирован: ${actError}` : 'Акт не сформирован' };
  if (attachments.length) {
    actResult = await sendEmailAsUser(userId, {
      recipients,
      subject: act.subject,
      text: act.body,
      attachments,
    });
  } else if (actError) {
    console.error('Акт-предписание не сформирован:', actError);
  }

  const sent = notifyResult.sent || actResult.sent;
  return {
    sent,
    notify: notifyResult,
    act: actResult,
    actError: actError || null,
    recipientsRequested: recipients || [],
    recipientsNotified: notifyResult.recipients || [],
    recipientsAct: actResult.recipients || [],
    failedNotify: notifyResult.failed || [],
    failedAct: actResult.failed || [],
    attachmentCount: attachments.length,
    hasAct: attachments.length > 0 && actResult.sent,
    message: sent
      ? [
          notifyResult.sent ? 'Уведомление отправлено' : null,
          actResult.sent ? `Акт отправлен (${attachments.length} влож.)` : actResult.message,
        ]
          .filter(Boolean)
          .join(' · ')
      : [notifyResult.message, actResult.message].filter(Boolean).join(' · '),
  };
}

function violationHistoryHasText(v, needle) {
  return (v.history || []).some((h) => String(h?.text || '').includes(needle));
}

function violationNeedsDeadlineReminder(v) {
  if (!v.deadline || v.deadlineExpiredNotified) return false;
  if (violationHistoryHasText(v, 'Срок устранения истёк — отправлено уведомление')) return false;
  if (v.status === 'resolved' || v.status === 'verification') return false;
  return new Date(v.deadline) < new Date();
}

async function processDeadlineExpiredViolations() {
  const db = await readDb();
  const allUsers = await usersStore.listUsers();
  const admin = allUsers.find((a) => permissions.normalizeRole(a.role) === 'admin');
  let changed = false;

  for (const v of db.violations) {
    if (!violationNeedsDeadlineReminder(v)) continue;
    const av = applyOverdue(v);
    if (v.status !== 'overdue' && av.status === 'overdue') v.status = 'overdue';
    v.deadlineExpiredNotified = true;
    v.history = v.history || [];
    v.history.push({
      at: new Date().toISOString(),
      text: 'Срок устранения истёк — отправлено уведомление на почту',
      by: 'Система',
    });
    changed = true;

    const linkedUsers = projectScope.findUsersForViolation(db, applyOverdue(v), allUsers);
    const recipients = await resolveEmailRecipients({ violation: v, db, body: {}, linkedUsers });
    const ctx = templates.getViolationContext(applyOverdue(v), db, categoriesLib.getCategories(db));
    const mail = templates.buildEmailDeadlineExpired(ctx, v.responsible);

    if (admin && recipients.length) {
      await sendEmailAsUser(admin.id, {
        recipients,
        subject: mail.subject,
        text: mail.body,
      }).catch((e) => console.error('deadline email:', e.message || e));
    }

    if (admin) {
      db.notifications = db.notifications || [];
      db.notifications.unshift({
        id: `dl${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        userId: admin.id,
        channel: 'admin',
        type: 'deadline_expired',
        title: `Срок истёк: №${v.number}`,
        message: `${ctx.object?.name || '—'} — срок устранения прошёл`,
        body: mail.body,
        isRead: false,
        read: false,
        violationId: v.id,
        createdAt: new Date().toISOString(),
        at: new Date().toISOString(),
      });
    }
  }

  if (changed) await writeDb(db);
}

function violationNeedsApproachingReminder(v) {
  if (!violationCritical.isDeadlineCritical(v)) return false;
  if (v.deadlineApproachingNotified) return false;
  if (violationHistoryHasText(v, 'осталось менее 2 суток — отправлено уведомление')) return false;
  return true;
}

async function processDeadlineApproachingViolations() {
  const db = await readDb();
  const allUsers = await usersStore.listUsers();
  const admin = allUsers.find((a) => permissions.normalizeRole(a.role) === 'admin');
  let changed = false;

  for (const v of db.violations) {
    if (!violationNeedsApproachingReminder(v)) continue;
    v.deadlineApproachingNotified = true;
    v.history = v.history || [];
    v.history.push({
      at: new Date().toISOString(),
      text: 'До срока устранения осталось менее 2 суток — отправлено уведомление',
      by: 'Система',
    });
    changed = true;

    const linkedUsers = projectScope.findUsersForViolation(db, applyOverdue(v), allUsers);
    const recipients = await resolveEmailRecipients({ violation: v, db, body: {}, linkedUsers });
    const ctx = templates.getViolationContext(applyOverdue(v), db, categoriesLib.getCategories(db));
    const mail = templates.buildEmailDeadlineApproaching(ctx, v.responsible);

    if (admin && recipients.length) {
      await sendEmailAsUser(admin.id, {
        recipients,
        subject: mail.subject,
        text: mail.body,
      }).catch((e) => console.error('deadline approaching email:', e.message || e));
    }

    if (admin) {
      db.notifications = db.notifications || [];
      db.notifications.unshift({
        id: `da${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
        userId: admin.id,
        channel: 'admin',
        type: 'deadline_approaching',
        title: `Срок скоро: №${v.number}`,
        message: `${ctx.object?.name || '—'} — до срока менее 2 суток`,
        body: mail.body,
        isRead: false,
        read: false,
        violationId: v.id,
        createdAt: new Date().toISOString(),
        at: new Date().toISOString(),
      });
    }
  }

  if (changed) await writeDb(db);
}

async function syncDeadlineFlagsFromHistory() {
  const db = await readDb();
  let changed = false;
  for (const v of db.violations) {
    if (
      !v.deadlineApproachingNotified &&
      violationHistoryHasText(v, 'осталось менее 2 суток — отправлено уведомление')
    ) {
      v.deadlineApproachingNotified = true;
      changed = true;
    }
    if (
      !v.deadlineExpiredNotified &&
      violationHistoryHasText(v, 'Срок устранения истёк — отправлено уведомление')
    ) {
      v.deadlineExpiredNotified = true;
      changed = true;
    }
  }
  if (changed) await writeDb(db);
}

async function processDeadlineViolations() {
  await syncDeadlineFlagsFromHistory();
  await processDeadlineApproachingViolations();
  await processDeadlineExpiredViolations();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function analytics(db) {
  const all = db.violations.map(applyOverdue);
  const resolved = all.filter((v) => v.status === 'resolved' || v.status === 'verification').length;
  const overdue = all.filter((v) => v.status === 'overdue' || isOverdue(v)).length;
  const critical = all.filter((v) => violationCritical.isDeadlineCritical(v)).length;
  const byCategory = {};
  const byOrg = {};
  all.forEach((v) => {
    const cat = categoriesLib.categoryLabel(v, categoriesLib.getCategories(db));
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const org = db.contractors.find((c) => c.id === v.contractorId)?.name || '—';
    byOrg[org] = (byOrg[org] || 0) + 1;
  });
  const topOrgs = Object.entries(byOrg)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  return {
    total: all.length,
    resolved,
    resolvedPct: all.length ? Math.round((resolved / all.length) * 100) : 0,
    overdue,
    critical,
    byCategory: Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count })),
    topOrganizations: topOrgs,
    recent: [...all].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 10),
  };
}

function pathParam(raw) {
  try {
    return decodeURIComponent(String(raw || ''));
  } catch {
    return String(raw || '');
  }
}

function upsertTrainingViolationForContractor(db, user) {
  const TRAINING_MARKER = '[TRAINING_CONTRACTOR]';
  let contractorId = String(user?.contractorId || '').trim();
  if (!contractorId && user?.company) {
    const company = String(user.company || '').trim().toLowerCase();
    const con = (db.contractors || []).find(
      (c) => String(c.name || '').trim().toLowerCase() === company
    );
    if (con) contractorId = con.id;
  }
  if (!contractorId) {
    const err = new Error('Пользователь не привязан к организации');
    err.status = 400;
    throw err;
  }

  const existing = (db.violations || []).find(
    (v) =>
      String(v.contractorId || '') === contractorId &&
      String(v.description || '').includes(TRAINING_MARKER) &&
      String(v.status || '') !== 'resolved'
  );
  if (existing) return { violation: existing, created: false };

  const scopedIds = projectScope.normalizeObjectIds(user?.objectIds);
  const obj =
    (scopedIds.length && db.objects.find((o) => scopedIds.includes(String(o.id)))) ||
    (db.objects || []).find((o) => o.id) ||
    db.objects[0];
  if (!obj) {
    const err = new Error('Нет объектов для учебного тикета');
    err.status = 400;
    throw err;
  }

  const category = (categoriesLib.getCategories(db) || [])[0] || { id: 'other' };
  const nowIso = new Date().toISOString();
  const number = nextNumber(db, obj.code || 'TRN');
  const violation = {
    id: 'vtrn' + Date.now(),
    number,
    objectId: obj.id,
    contractorId,
    categoryId: category.id || 'other',
    categoryOther: '',
    severity: 'major',
    description:
      `${TRAINING_MARKER} Учебный тикет: обнаружены некорректные ограждения в зоне складирования. ` +
      'Добавьте комментарий с планом действий, затем отправьте отчёт об устранении с фото.',
    status: 'new',
    deadline: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
    createdAt: nowIso,
    responsible: projectScope.userActPersonName(user) || projectScope.userDisplayName(user) || 'Подрядчик',
    responsibleUserId: user.id,
    createdByUserId: user.id,
    createdByName: 'Система обучения',
    createdByEmail: 'system@visural.local',
    media: [],
    history: [{ at: nowIso, text: 'Нарушение создано', by: 'Система обучения' }],
    comments: [],
    normRefs: [],
    locationGps: null,
  };
  db.violations.unshift(violation);
  return { violation, created: true };
}

function cleanupTrainingViolationsForUser(db, user) {
  if (!user?.id) return [];
  const uid = String(user.id);
  const removed = [];
  const keep = [];
  for (const v of db.violations || []) {
    const isMine =
      (permissions.isTrainingPracticeViolation(v) && String(v.createdByUserId || '') === uid) ||
      (permissions.isTrainingContractorViolation(v) && String(v.responsibleUserId || '') === uid);
    if (isMine) removed.push(v.id);
    else keep.push(v);
  }
  removed.forEach((id) => mediaStore.deleteViolationMedia(id));
  db.violations = keep;
  if (Array.isArray(db.notifications)) {
    const gone = new Set(removed);
    db.notifications = db.notifications.filter((n) => !gone.has(n.violationId));
  }
  return removed;
}

async function handleApi(req, res, pathname) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const user = await resolveSessionUser(token);

  const mediaMatch = pathname.match(/^\/api\/media\/([^/]+)\/([^/]+)$/);
  if (mediaMatch && req.method === 'GET') {
    mediaStore.serveMedia(res, mediaMatch[1], mediaMatch[2]);
    return;
  }

  if (pathname === '/api/health' && req.method === 'GET') {
    const lanIp = getLanIp();
    const apkInfo = readApkVersionInfo();
    const apkPath = resolveApkFile();
    const apkAvailable = !!apkPath;
    return json(res, 200, {
      ok: true,
      service: 'Visural Audit API',
      version: '1.2.5',
      build: 11,
      lanIp,
      mobileUrl: (() => {
        const base = publicBaseUrl(PUBLIC_HOST || lanIp);
        return base ? `${base}/mobile/` : null;
      })(),
      apk: apkAvailable
        ? {
            version: apkInfo.version,
            versionCode: apkInfo.versionCode,
            url: apkDownloadUrl(apkInfo, apkPath),
            builtAt: apkInfo.builtAt || null,
          }
        : null,
      userDb: usersStore.pgEnabled() ? 'postgresql' : 'json',
      dataDb: dataStore.pgEnabled() ? 'postgresql' : 'json',
      security: { passwordHash: 'argon2id' },
      features: {
        registration: true,
        emailVerification: true,
        adminUsers: true,
      },
      mail: {
        configured: mailer.emailConfigured(),
        provider: mailer.emailProvider(),
        smtpHost: process.env.SMTP_HOST || null,
        from: process.env.DEFAULT_NOTIFY_EMAIL || null,
      },
      users: {
        store: usersStore.pgEnabled() ? 'postgresql' : 'json',
        count: (await usersStore.listUsers()).length,
      },
    });
  }

  if (pathname === '/api/mobile/apk-info' && req.method === 'GET') {
    const info = readApkVersionInfo();
    const apkPath = resolveApkFile();
    return json(res, 200, {
      ...info,
      available: !!apkPath,
      url: apkDownloadUrl(info, apkPath),
    });
  }

  if (pathname === '/api/mobile/apk' && req.method === 'GET') {
    const apkPath = resolveApkFile();
    if (!apkPath) return json(res, 404, { error: 'APK не найден на сервере' });
    return serveApkDownload(res, apkPath);
  }

  if (pathname === '/api/public/organizations' && req.method === 'GET') {
    const db = await readDb();
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const q = reqUrl.searchParams.get('q') || '';
    const organizations = projectScope.searchOrganizationsByQuery(db, q, 12);
    return json(res, 200, { organizations });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    const result = await usersStore.login(email, password);
    if (!result) return json(res, 401, { error: 'Неверный email или пароль' });
    return json(res, 200, { token: result.token, user: sanitizeUser(result.user) });
  }

  if (pathname === '/api/auth/repair-admin' && req.method === 'POST') {
    const body = await readBody(req);
    const secret = String(body.secret || body.token || '').trim();
    const expected = String(process.env.VC_ADMIN_PASSWORD || 'VictoryAdmin2026!').trim();
    if (!secret || secret !== expected) {
      return json(res, 403, { error: 'Недостаточно прав' });
    }
    process.env.VC_FORCE_ADMIN_PASSWORD = 'true';
    const email = process.env.VC_ADMIN_EMAIL || 'admin@victory-check.ru';
    const result = await usersStore.ensureAdminUser({
      email,
      password: expected,
      firstName: process.env.VC_ADMIN_FIRST_NAME || 'Victory',
      lastName: process.env.VC_ADMIN_LAST_NAME || 'Admin',
    });
    const login = await usersStore.login(email, expected);
    if (!login) {
      return json(res, 500, { error: 'Не удалось восстановить вход администратора' });
    }
    return json(res, 200, {
      ok: true,
      email,
      created: !!result.created,
      message: 'Пароль администратора восстановлен. Войдите с паролем из VC_ADMIN_PASSWORD на сервере.',
    });
  }

  if (pathname === '/api/auth/forgot-password' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || email.indexOf('@') < 1) {
      return json(res, 400, { error: 'Укажите корректный email' });
    }
    const verifyCode = String(body.code || '').trim();
    const newPassword = String(body.password || body.newPassword || '').trim();
    const now = Date.now();

    if (!verifyCode) {
      const found = await usersStore.findByEmail(email);
      if (!found) {
        return json(res, 200, {
          message: 'Если аккаунт существует, код отправлен на почту.',
        });
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await usersStore.savePasswordResetPending(email, {
        code,
        expiresAt: now + 15 * 60 * 1000,
      });
      try {
        const mail = await mailer.sendPasswordResetMail({
          to: email,
          firstName: found.firstName,
          code,
        });
        if (!mail?.sent) {
          await usersStore.deletePasswordResetPending(email);
          return json(res, 502, {
            error: mail?.message || 'Не удалось отправить письмо с кодом. Попробуйте позже.',
          });
        }
      } catch (e) {
        await usersStore.deletePasswordResetPending(email);
        return json(res, 502, {
          error: e.message || 'Не удалось отправить письмо с кодом. Попробуйте позже.',
        });
      }
      return json(res, 200, {
        needsVerification: true,
        message: `Код отправляется на ${email}. Проверьте почту через минуту (и папку «Спам»).`,
      });
    }

    if (newPassword.length < 6) {
      return json(res, 400, { error: 'Пароль не менее 6 символов' });
    }
    const pending = await usersStore.getPasswordResetPending(email);
    if (!pending) {
      return json(res, 400, { error: 'Сначала запросите код на почту' });
    }
    if ((pending.expiresAt || 0) < now) {
      await usersStore.deletePasswordResetPending(email);
      return json(res, 400, { error: 'Код истёк. Запросите новый.' });
    }
    if (String(pending.code) !== verifyCode) {
      return json(res, 400, { error: 'Неверный код. Проверьте письмо.' });
    }
    const updated = await usersStore.resetPasswordByEmail(email, newPassword);
    if (!updated) {
      return json(res, 404, { error: 'Пользователь не найден' });
    }
    await usersStore.deletePasswordResetPending(email);
    return json(res, 200, { message: 'Пароль обновлён. Теперь можно войти.' });
  }

  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '').trim();
    const fullName = String(body.name || body.fullName || '').trim();
    const companyRaw = String(body.company || '').trim();
    const phone = String(body.phone || '').trim();
    const jobTitle = String(body.jobTitle || body.job_title || '').trim();
    const verifyCode = String(body.code || '').trim();

    if (!email || email.indexOf('@') < 1) {
      return json(res, 400, { error: 'Укажите корректный email' });
    }
    if (verifyCode && password.length < 6) {
      return json(res, 400, { error: 'Пароль не менее 6 символов' });
    }

    const parts = fullName.split(/\s+/).filter(Boolean);
    const parsedName = (() => {
      try {
        const { parseRussianPersonName } = require('./prescription-doc');
        return parseRussianPersonName(fullName);
      } catch (_) {
        return null;
      }
    })();
    const firstName =
      parsedName?.firstName || parts[0] || 'Пользователь';
    const lastName =
      parsedName?.lastName || parts.slice(1).join(' ') || 'Новый';
    const now = Date.now();

    if (await usersStore.emailExists(email)) {
      return json(res, 409, { error: 'Этот email уже зарегистрирован' });
    }

    const dbForCompany = await readDb();
    const company = projectScope.resolveCanonicalCompanyName(dbForCompany, companyRaw);

    if (!verifyCode) {
      if (!fullName) {
        return json(res, 400, { error: 'Укажите ФИО' });
      }
      if (!company) {
        return json(res, 400, { error: 'Укажите организацию' });
      }
      if (!phone) {
        return json(res, 400, { error: 'Укажите номер телефона' });
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      await usersStore.saveRegistrationPending(email, {
        code,
        firstName,
        lastName,
        fullName,
        company,
        phone,
        jobTitle,
        expiresAt: now + 15 * 60 * 1000,
        createdAt: new Date().toISOString(),
      });

      try {
        const mail = await mailer.sendRegistrationMail({ to: email, firstName, code });
        if (!mail?.sent) {
          await usersStore.deleteRegistrationPending(email);
          return json(res, 502, {
            error: mail?.message || 'Не удалось отправить письмо с кодом. Попробуйте позже.',
          });
        }
      } catch (e) {
        await usersStore.deleteRegistrationPending(email);
        return json(res, 502, {
          error: e.message || 'Не удалось отправить письмо с кодом. Попробуйте позже.',
        });
      }

      return json(res, 200, {
        needsVerification: true,
        company,
        companyMatched: company !== companyRaw,
        message: `Код отправляется на ${email}. Проверьте почту через минуту (и папку «Спам»).`,
      });
    }

    const pending = await usersStore.getRegistrationPending(email);
    if (!pending) {
      return json(res, 400, { error: 'Сначала запросите код на почту' });
    }
    if ((pending.expiresAt || 0) < now) {
      await usersStore.deleteRegistrationPending(email);
      return json(res, 400, { error: 'Код истёк. Запросите новый.' });
    }
    if (String(pending.code) !== verifyCode) {
      return json(res, 400, { error: 'Неверный код. Проверьте письмо.' });
    }

    const id = 'u' + Date.now();
    const nu = await usersStore.createUser({
      id,
      email,
      password,
      role: 'viewer',
      firstName: pending.firstName || firstName,
      lastName: pending.lastName || lastName,
      notifyEmail: email,
      status: 'pending',
      company: pending.company || company,
      phone: pending.phone || phone,
      jobTitle: pending.jobTitle || jobTitle,
    });
    await usersStore.deleteRegistrationPending(email);
    const db = await readDb();
    await autoLinkUserToContractor(db, id, nu.company);
    await notifyAdminsNewUser(db, nu);
    await writeDb(db);
    const linked = (await usersStore.getUserById(id)) || nu;
    const t = await usersStore.createSession(id);
    return json(res, 201, {
      token: t,
      user: sanitizeUser(linked),
      pendingApproval: true,
      company: linked.company || company,
      message: 'Регистрация принята. Дождитесь подтверждения администратором.',
    });
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Unauthorized' });
    return json(res, 200, { user });
  }

  if (pathname === '/api/auth/request-approval' && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const raw = await usersStore.getUserById(user.id);
    if (!raw) return json(res, 404, { error: 'Пользователь не найден' });
    if (!accountNeedsApproval(raw)) {
      return json(res, 400, { error: 'Подтверждение не требуется' });
    }
    const cooldownMs = 5 * 60 * 1000;
    if (raw.approvalRequestedAt) {
      const last = new Date(raw.approvalRequestedAt).getTime();
      if (Date.now() - last < cooldownMs) {
        return json(res, 200, {
          message: 'Запрос уже отправлен. Подождите несколько минут.',
          alreadySent: true,
          approvalRequestedAt: raw.approvalRequestedAt,
        });
      }
    }
    const db = await readDb();
    await notifyAdminsApprovalRequest(db, raw);
    await writeDb(db);
    const approvalRequestedAt = new Date().toISOString();
    await usersStore.updateUser(user.id, { approvalRequestedAt });
    return json(res, 200, {
      message: 'Запрос отправлен администратору',
      approvalRequestedAt,
    });
  }

  if (pathname === '/api/auth/profile' && req.method === 'PATCH') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const body = await readBody(req);
    const patch = {};
    if (body.avatarUrl !== undefined) {
      patch.avatarUrl = validateAvatarUrl(body.avatarUrl);
    }
    if (body.fullName !== undefined) {
      const parts = String(body.fullName || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) {
        return json(res, 400, { error: 'Укажите ФИО' });
      }
      patch.firstName = parts[0];
      patch.lastName = parts.slice(1).join(' ') || '';
    } else {
      if (body.firstName !== undefined) {
        const firstName = String(body.firstName || '').trim();
        if (!firstName) return json(res, 400, { error: 'Укажите имя' });
        patch.firstName = firstName;
      }
      if (body.lastName !== undefined) {
        patch.lastName = String(body.lastName || '').trim();
      }
    }
    if (body.company !== undefined) {
      patch.company = String(body.company || '').trim();
    }
    if (body.phone !== undefined) {
      patch.phone = String(body.phone || '').trim();
    }
    if (body.jobTitle !== undefined || body.job_title !== undefined) {
      patch.jobTitle = String(body.jobTitle ?? body.job_title ?? '').trim();
    }
    if (body.tutorialCompleted !== undefined) {
      patch.tutorialCompleted = !!body.tutorialCompleted;
    }
    if (!Object.keys(patch).length) {
      return json(res, 400, { error: 'Нет данных для обновления' });
    }
    const updated = await usersStore.updateUser(user.id, patch);
    return json(res, 200, { user: sanitizeUser(updated) });
  }

  if (pathname === '/api/onboarding/contractor-ticket' && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const role = permissions.normalizeRole(user.role);
    if (role !== 'contractor') {
      return forbid(res, 'Учебный тикет доступен только для роли подрядчика');
    }
    if (String(user.status || 'active').toLowerCase() !== 'active') {
      return json(res, 409, { error: 'Учебный тикет доступен после подтверждения аккаунта' });
    }
    const db = await readDb();
    try {
      const result = upsertTrainingViolationForContractor(db, user);
      await writeDb(db);
      return json(res, 200, { violation: applyOverdue(result.violation), created: result.created });
    } catch (e) {
      const status = Number(e?.status) || 400;
      return json(res, status, { error: e.message || 'Не удалось создать учебный тикет' });
    }
  }

  if (pathname === '/api/onboarding/cleanup' && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const db = await readDb();
    const removed = cleanupTrainingViolationsForUser(db, user);
    if (removed.length) await writeDb(db);
    return json(res, 200, { ok: true, removed });
  }

  if (pathname === '/api/auth/google/url' && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    if (!googleMail.isConfigured()) {
      return json(res, 400, {
        error: 'Google не настроен на сервере. Запустите setup-google.ps1 (один раз).',
      });
    }
    return json(res, 200, { url: googleMail.getAuthUrl(user.id, SECRET, PORT) });
  }

  if (pathname === '/api/auth/google/callback' && req.method === 'GET') {
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const err = u.searchParams.get('error');
    const mobileOk = `/mobile/?gmail=connected`;
    const mobileFail = `/mobile/?gmail=error`;
    if (err || !code) {
      res.writeHead(302, { Location: mobileFail });
      res.end();
      return;
    }
    const payload = googleMail.verifyState(state, SECRET);
    if (!payload?.userId) {
      res.writeHead(302, { Location: mobileFail });
      res.end();
      return;
    }
    try {
      const tokens = await googleMail.exchangeCode(code, PORT);
      const linked = await usersStore.getUserById(payload.userId);
      if (linked && tokens.refresh_token) {
        await usersStore.updateUser(payload.userId, {
          googleRefreshToken: tokens.refresh_token,
          googleEmail: linked.email,
        });
      } else if (linked && tokens.access_token) {
        await usersStore.updateUser(payload.userId, {
          googleAccessToken: tokens.access_token,
        });
      }
      res.writeHead(302, { Location: mobileOk });
      res.end();
    } catch (e) {
      console.error('Google callback:', e.message);
      res.writeHead(302, { Location: `${mobileFail}&msg=${encodeURIComponent(e.message)}` });
      res.end();
    }
    return;
  }

  if (pathname === '/api/auth/google' && req.method === 'DELETE') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    await usersStore.clearGoogleTokens(user.id);
    return json(res, 200, { ok: true, googleConnected: false });
  }

  if (pathname === '/api/telegram/info' && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const db = await readDb();
    const u = await usersStore.getUserById(user.id);
    let botUsername = null;
    if (telegram.isConfigured()) {
      try {
        const bot = await telegram.getBotInfo();
        botUsername = bot.username;
      } catch (_) {}
    }
    const linkCode = `vc_${user.id}`;
    return json(res, 200, {
      configured: telegram.isConfigured(),
      botUsername,
      linkUrl: botUsername ? `https://t.me/${botUsername}?start=${linkCode}` : null,
      telegramConnected: !!(u?.telegramChatId),
      subscribers: (db.telegramChats || []).length,
    });
  }

  if (pathname === '/api/telegram/sync' && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    if (!telegram.isConfigured()) {
      return json(res, 400, { error: 'Telegram bot not configured' });
    }
    const db = await readDb();
    const result = await telegram.pollAndLink();
    const u = await usersStore.getUserById(user.id);
    return json(res, 200, {
      ...result,
      telegramConnected: !!(u?.telegramChatId),
      subscribers: (db.telegramChats || []).length,
    });
  }

  if (pathname === '/api/notification-settings' && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const u = await usersStore.getUserById(user.id);
    return json(res, 200, {
      settings: user.notificationSettings,
      notifyEmail: u?.notifyEmail || '',
      smtpConfigured: mailer.emailConfigured(),
      emailProvider: mailer.emailProvider(),
      sendToAnyone: mailer.canSendToAnyone() || googleMail.isConfigured(),
      googleConfigured: googleMail.isConfigured(),
      googleConnected: !!(u?.googleRefreshToken),
      telegramConfigured: telegram.isConfigured(),
      telegramConnected: !!(u?.telegramChatId),
    });
  }

  if (pathname === '/api/notification-settings' && req.method === 'PATCH') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const body = await readBody(req);
    const u = await usersStore.getUserById(user.id);
    if (!u) return json(res, 404, { error: 'Пользователь не найден' });
    const patch = {};
    if (body.notifyEmail !== undefined) {
      patch.notifyEmail = String(body.notifyEmail || '').trim();
    }
    const settingsPatch = { ...body };
    delete settingsPatch.notifyEmail;
    if (Object.keys(settingsPatch).length) {
      patch.notificationSettings = notifConfig.mergeSettings({
        ...u.notificationSettings,
        ...settingsPatch,
      });
    }
    const updated = await usersStore.updateUser(user.id, patch);
    return json(res, 200, {
      settings: notifConfig.mergeSettings(updated?.notificationSettings),
      notifyEmail: updated?.notifyEmail || '',
      smtpConfigured: mailer.emailConfigured(),
      emailProvider: mailer.emailProvider(),
      sendToAnyone: mailer.canSendToAnyone() || googleMail.isConfigured(),
      googleConfigured: googleMail.isConfigured(),
      googleConnected: !!(updated?.googleRefreshToken),
      telegramConfigured: telegram.isConfigured(),
      telegramConnected: !!(updated?.telegramChatId),
    });
  }

  const userIdMatch = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (pathname === '/api/users' && req.method === 'GET') {
    if (!user || user.role !== 'admin') {
      return json(res, 403, { error: 'Только для администратора' });
    }
    const users = await usersStore.listUsers();
    const pendingRegistrations = await usersStore.listRegistrationPending();
    return json(res, 200, { users, pendingRegistrations, total: users.length });
  }
  if (userIdMatch && req.method === 'PATCH') {
    if (!user || user.role !== 'admin') {
      return json(res, 403, { error: 'Только для администратора' });
    }
    const targetId = userIdMatch[1];
    const body = await readBody(req);
    const target = await usersStore.getUserById(targetId);
    if (!target) return json(res, 404, { error: 'Пользователь не найден' });

    const patch = {};

    if (body.role !== undefined) {
      const role = permissions.normalizeRole(body.role);
      if (!ALLOWED_ROLES.includes(role)) {
        return json(res, 400, { error: 'Недопустимая роль' });
      }
      if (targetId === user.id && role !== 'admin') {
        return json(res, 400, { error: 'Нельзя снять с себя роль администратора' });
      }
      patch.role = role;
    }

    if (body.status !== undefined) {
      const status = String(body.status).toLowerCase();
      if (!['pending', 'active', 'rejected'].includes(status)) {
        return json(res, 400, { error: 'Недопустимый статус' });
      }
      patch.status = status;
      if (status === 'active' && String(target.status || '').toLowerCase() === 'pending') {
        patch.role = 'contractor';
      }
    }

    if (body.contractorId !== undefined) {
      patch.contractorId = body.contractorId || null;
    }

    if (body.company !== undefined) {
      patch.company = String(body.company || '').trim();
    }

    if (body.objectIds !== undefined) {
      patch.objectIds = projectScope.normalizeObjectIds(body.objectIds);
    }

    if (body.firstName !== undefined) {
      patch.firstName = String(body.firstName || '').trim();
    }

    if (body.lastName !== undefined) {
      patch.lastName = String(body.lastName || '').trim();
    }

    if (body.phone !== undefined) {
      patch.phone = String(body.phone || '').trim();
    }

    if (body.jobTitle !== undefined || body.job_title !== undefined) {
      patch.jobTitle = String(body.jobTitle ?? body.job_title ?? '').trim();
    }

    const dbForLink = await readDb();
    const companyForLink = patch.company !== undefined ? patch.company : target.company;
    if (
      (patch.status === 'active' || patch.role === 'contractor') &&
      !target.contractorId &&
      !patch.contractorId &&
      companyForLink
    ) {
      const match = projectScope.findContractorByCompanyName(dbForLink, companyForLink);
      if (match) {
        patch.contractorId = match.id;
        patch.company = match.name;
      }
    }

    if (body.email !== undefined) {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email.includes('@') || !email.includes('.')) {
        return json(res, 400, { error: 'Некорректный email' });
      }
      if (email !== String(target.email || '').toLowerCase()) {
        if (await usersStore.emailExists(email)) {
          return json(res, 409, { error: 'Этот email уже занят' });
        }
        patch.email = email;
      }
    }

    if (!Object.keys(patch).length) {
      return json(res, 400, { error: 'Неизвестное поле' });
    }

    if (patch.role === 'contractor' && !target.contractorId && !patch.contractorId && target.company) {
      const db = dbForLink || (await readDb());
      const match = projectScope.findContractorByCompanyName(db, patch.company || target.company);
      if (match) {
        patch.contractorId = match.id;
        if (!patch.company) patch.company = match.name;
      }
    }

    const updated = await usersStore.updateUser(targetId, patch);
    if (!updated) return json(res, 404, { error: 'Пользователь не найден' });
    return json(res, 200, { user: formatAdminUser(updated) });
  }
  if (userIdMatch && req.method === 'DELETE') {
    if (!user || user.role !== 'admin') {
      return json(res, 403, { error: 'Только для администратора' });
    }
    const targetId = userIdMatch[1];
    if (targetId === user.id) {
      return json(res, 400, { error: 'Нельзя удалить свой аккаунт' });
    }
    const removed = await usersStore.deleteUser(targetId);
    if (!removed) return json(res, 404, { error: 'Пользователь не найден' });
    return json(res, 200, { ok: true });
  }

  const publicGet = ['/api/categories'];
  if (!user && !publicGet.includes(pathname)) {
    if (req.method !== 'OPTIONS') return json(res, 401, { error: 'Требуется авторизация' });
  }

  if (pathname === '/api/categories' && req.method === 'GET') {
    const db = await readDb();
    return json(res, 200, { categories: categoriesLib.getCategories(db) });
  }

  const categoryMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);

  if (pathname === '/api/categories' && req.method === 'POST') {
    if (!permissions.can(dbUser(user), 'manageDirectories')) {
      return forbid(res, 'Управление справочниками недоступно');
    }
    const body = await readBody(req);
    const db = await readDb();
    categoriesLib.ensureCategories(db);
    const name = String(body.name || '').trim();
    if (!name) return json(res, 400, { error: 'Укажите название категории' });
    const id = String(body.id || categoriesLib.slugifyId(name)).trim();
    if (db.categories.some((c) => c.id === id)) {
      return json(res, 409, { error: 'Категория с таким ID уже есть' });
    }
    const cat = categoriesLib.normalizeCategory(
      {
        id,
        name,
        icon: body.icon,
        sortOrder: body.sortOrder ?? db.categories.length + 1,
      },
      db.categories.length
    );
    db.categories.push(cat);
    await writeDb(db);
    return json(res, 201, { category: cat });
  }

  if (categoryMatch && req.method === 'PATCH') {
    if (!permissions.can(dbUser(user), 'manageDirectories')) {
      return forbid(res, 'Управление справочниками недоступно');
    }
    const body = await readBody(req);
    const db = await readDb();
    categoriesLib.ensureCategories(db);
    const id = pathParam(categoryMatch[1]);
    const idx = db.categories.findIndex((c) => c.id === id);
    if (idx < 0) return json(res, 404, { error: 'Категория не найдена' });
    const current = db.categories[idx];
    const next = categoriesLib.normalizeCategory(
      {
        id,
        name: body.name !== undefined ? body.name : current.name,
        icon: body.icon !== undefined ? body.icon : current.icon,
        sortOrder: body.sortOrder !== undefined ? body.sortOrder : current.sortOrder,
      },
      idx
    );
    db.categories[idx] = next;
    await writeDb(db);
    return json(res, 200, { category: next });
  }

  if (categoryMatch && req.method === 'DELETE') {
    if (!permissions.can(dbUser(user), 'manageDirectories')) {
      return forbid(res, 'Управление справочниками недоступно');
    }
    const id = pathParam(categoryMatch[1]);
    if (id === 'other') {
      return json(res, 400, { error: 'Категорию «Другое» нельзя удалить' });
    }
    const db = await readDb();
    categoriesLib.ensureCategories(db);
    if (db.violations.some((v) => v.categoryId === id)) {
      return json(res, 409, { error: 'Нельзя удалить: есть нарушения с этой категорией' });
    }
    const before = db.categories.length;
    db.categories = db.categories.filter((c) => c.id !== id);
    if (db.categories.length === before) return json(res, 404, { error: 'Категория не найдена' });
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  function normalizeContractor(c) {
    return { ...c, type: c.type || (/^ИП\s/i.test(c.name) ? 'ip' : 'ooo') };
  }

  if (pathname === '/api/objects' && req.method === 'GET') {
    const db = await readDb();
    return json(res, 200, { objects: db.objects });
  }

  if (pathname === '/api/objects' && req.method === 'POST') {
    if (!permissions.can(dbUser(user), 'manageDirectories')) {
      return forbid(res, 'Управление справочниками недоступно');
    }
    const body = await readBody(req);
    const db = await readDb();
    const name = String(body.name || '').trim();
    const code = String(body.code || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '');
    if (!name || !code) return json(res, 400, { error: 'Укажите название и код объекта' });
    if (db.objects.some((o) => o.code === code)) {
      return json(res, 400, { error: 'Код объекта уже используется' });
    }
    const obj = {
      id: 'o' + Date.now(),
      name,
      code,
      address: String(body.address || '').trim(),
    };
    db.objects.push(obj);
    if (!db.seq[code]) db.seq[code] = 0;
    await writeDb(db);
    return json(res, 201, { object: obj });
  }

  const objectMatch = pathname.match(/^\/api\/objects\/([^/]+)$/);
  if (objectMatch && req.method === 'DELETE') {
    if (!permissions.can(dbUser(user), 'manageDirectories')) {
      return forbid(res, 'Управление справочниками недоступно');
    }
    const db = await readDb();
    const id = objectMatch[1];
    if (db.violations.some((v) => v.objectId === id)) {
      return json(res, 409, { error: 'Нельзя удалить: есть связанные нарушения' });
    }
    const before = db.objects.length;
    db.objects = db.objects.filter((o) => o.id !== id);
    if (db.objects.length === before) return json(res, 404, { error: 'Объект не найден' });
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/contractors' && req.method === 'GET') {
    const db = await readDb();
    return json(res, 200, { contractors: db.contractors.map(normalizeContractor) });
  }

  if (pathname === '/api/contractors' && req.method === 'POST') {
    if (!permissions.can(dbUser(user), 'manageDirectories')) {
      return forbid(res, 'Управление справочниками недоступно');
    }
    const body = await readBody(req);
    const db = await readDb();
    const name = String(body.name || '').trim();
    if (!name) return json(res, 400, { error: 'Укажите название организации' });
    const c = {
      id: 'c' + Date.now(),
      name,
      type: /^ИП\s/i.test(name) ? 'ip' : 'ooo',
      inn: String(body.inn || '').trim(),
      executor: String(body.executor || '').trim(),
      email: String(body.email || '').trim(),
    };
    db.contractors.push(c);
    await writeDb(db);
    return json(res, 201, { contractor: normalizeContractor(c) });
  }

  const contractorMembersMatch = pathname.match(/^\/api\/contractors\/([^/]+)\/members$/);
  if (contractorMembersMatch && req.method === 'GET') {
    const db = await readDb();
    const contractorId = contractorMembersMatch[1];
    const contractor = db.contractors.find((c) => c.id === contractorId);
    if (!contractor) return json(res, 404, { error: 'Организация не найдена' });
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const objectId = reqUrl.searchParams.get('objectId') || '';
    const allUsers = await usersStore.listUsers();
    const members = projectScope
      .sortMembersHeadFirst(
        projectScope.findMembersForContractor(db, contractorId, objectId || null, allUsers)
      )
      .map((u) => projectScope.formatMember(u, db));
    return json(res, 200, { members, contractor: normalizeContractor(contractor) });
  }

  if (contractorMembersMatch && req.method === 'POST') {
    if (!user || user.role !== 'admin') {
      return json(res, 403, { error: 'Только для администратора' });
    }
    const contractorId = contractorMembersMatch[1];
    const db = await readDb();
    const contractor = db.contractors.find((c) => c.id === contractorId);
    if (!contractor) return json(res, 404, { error: 'Организация не найдена' });
    const body = await readBody(req);
    const objectIds = projectScope.normalizeObjectIds(body.objectIds);

    if (body.userIds && Array.isArray(body.userIds)) {
      const ids = body.userIds.map((x) => String(x).trim()).filter(Boolean);
      const updated = [];
      for (const uid of ids) {
        const target = await usersStore.getUserById(uid);
        if (!target) continue;
        const u = await usersStore.updateUser(uid, {
          contractorId,
          company: contractor.name,
          objectIds: objectIds.length ? objectIds : target.objectIds,
          role: body.role ? permissions.normalizeRole(body.role) : target.role || 'contractor',
        });
        updated.push(projectScope.formatMember(u, db));
      }
      if (!updated.length) return json(res, 404, { error: 'Пользователи не найдены' });
      return json(res, 200, { members: updated, count: updated.length });
    }

    if (body.userId) {
      const target = await usersStore.getUserById(body.userId);
      if (!target) return json(res, 404, { error: 'Пользователь не найден' });
      const updated = await usersStore.updateUser(body.userId, {
        contractorId,
        company: contractor.name,
        objectIds: objectIds.length ? objectIds : target.objectIds,
        role: body.role ? permissions.normalizeRole(body.role) : target.role || 'contractor',
      });
      return json(res, 200, { user: formatAdminUser(updated), member: projectScope.formatMember(updated, db) });
    }

    const email = String(body.email || '').trim().toLowerCase();
    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim();
    const phone = String(body.phone || '').trim();
    const jobTitle = String(body.jobTitle || body.job_title || '').trim();
    const password = String(body.password || 'Victory2026!');
    if (!email.includes('@')) return json(res, 400, { error: 'Укажите корректный email' });
    if (!firstName) return json(res, 400, { error: 'Укажите имя' });
    const existing = await usersStore.findByEmail(email);
    if (existing) {
      const updated = await usersStore.updateUser(existing.id, {
        contractorId,
        company: contractor.name,
        objectIds: objectIds.length ? objectIds : existing.objectIds,
        role: permissions.normalizeRole(body.role || existing.role || 'contractor'),
        status: 'active',
        jobTitle: jobTitle || existing.jobTitle,
      });
      return json(res, 200, {
        linked: true,
        user: formatAdminUser(updated),
        member: projectScope.formatMember(updated, db),
      });
    }
    const nu = await usersStore.createUser({
      id: 'u' + Date.now(),
      email,
      password,
      role: permissions.normalizeRole(body.role || 'contractor'),
      firstName,
      lastName,
      phone,
      jobTitle,
      company: contractor.name,
      contractorId,
      objectIds,
      status: 'active',
      notifyEmail: email,
    });
    return json(res, 201, {
      user: formatAdminUser(nu),
      member: projectScope.formatMember(nu, db),
      tempPassword: password === 'Victory2026!' ? password : undefined,
    });
  }

  const contractorMatch = pathname.match(/^\/api\/contractors\/([^/]+)$/);
  if (contractorMatch && req.method === 'PATCH') {
    if (!permissions.can(dbUser(user), 'manageDirectories')) {
      return forbid(res, 'Управление справочниками недоступно');
    }
    const db = await readDb();
    const id = contractorMatch[1];
    const c = db.contractors.find((x) => x.id === id);
    if (!c) return json(res, 404, { error: 'Организация не найдена' });
    const body = await readBody(req);
    const prevName = c.name;
    const name = String(body.name != null ? body.name : c.name).trim();
    if (!name) return json(res, 400, { error: 'Укажите название организации' });
    c.name = name;
    c.inn = String(body.inn != null ? body.inn : c.inn).trim();
    c.executor = String(body.executor != null ? body.executor : c.executor).trim();
    c.email = String(body.email != null ? body.email : c.email).trim();
    c.type = /^ИП\s/i.test(name) ? 'ip' : 'ooo';
    await writeDb(db);
    if (prevName !== name) {
      const allUsers = await usersStore.listUsers();
      for (const u of allUsers) {
        if (u.contractorId === id) {
          await usersStore.updateUser(u.id, { company: name });
        }
      }
    }
    return json(res, 200, { contractor: normalizeContractor(c) });
  }

  if (contractorMatch && req.method === 'DELETE') {
    if (!permissions.can(dbUser(user), 'manageDirectories')) {
      return forbid(res, 'Управление справочниками недоступно');
    }
    const db = await readDb();
    const id = contractorMatch[1];
    if (db.violations.some((v) => v.contractorId === id)) {
      return json(res, 409, { error: 'Нельзя удалить: есть связанные нарушения' });
    }
    const before = db.contractors.length;
    db.contractors = db.contractors.filter((c) => c.id !== id);
    if (db.contractors.length === before) return json(res, 404, { error: 'Организация не найдена' });
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/violations' && req.method === 'GET') {
    const db = await readDb();
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const filter = u.searchParams.get('filter') || 'all';
    const search = (u.searchParams.get('search') || '').toLowerCase();
    const severity = u.searchParams.get('severity') || 'all';
    const status = u.searchParams.get('status') || 'all';
    const preset = u.searchParams.get('preset') || '';
    let items = db.violations.map(applyOverdue);
    items = permissions.filterViolations(dbUser(user), items);
    if (filter === 'history') {
      // полная история: все нарушения, включая устранённые
    } else if (filter === 'critical') {
      items = items.filter((v) => violationCritical.isDeadlineCritical(v));
    } else if (filter === 'overdue') items = items.filter((v) => v.status === 'overdue' || isOverdue(v));
    else if (filter === 'in_progress') items = items.filter((v) => v.status === 'in_progress' || v.status === 'new');
    else if (filter === 'resolved') {
      items = items.filter((v) => permissions.isClosedStatus(v.status) || v.status === 'verification');
    } else if (filter === 'all') {
      items = items.filter((v) => !permissions.isClosedStatus(v.status));
    }
    if (severity === 'critical') items = items.filter((v) => violationCritical.isDeadlineCritical(v));
    else if (severity === 'major') items = items.filter((v) => v.severity === 'major');
    else if (severity === 'minor') {
      items = items.filter((v) => v.severity === 'minor' || v.severity === 'recommendation');
    }
    if (status !== 'all') {
      if (status === 'resolved') {
        items = items.filter((v) => v.status === 'resolved' || v.status === 'verification');
      } else if (status === 'overdue') {
        items = items.filter((v) => v.status === 'overdue' || isOverdue(v));
      } else {
        items = items.filter((v) => v.status === status);
      }
    }
    if (preset && preset !== 'all') {
      const range = analyticsLib.datePreset(preset);
      if (range?.from) items = items.filter((v) => new Date(v.createdAt) >= new Date(range.from));
      if (range?.to) items = items.filter((v) => new Date(v.createdAt) <= new Date(range.to));
    }
    if (search) {
      items = items.filter((v) => {
        const obj = db.objects.find((o) => o.id === v.objectId)?.name || '';
        const org = db.contractors.find((c) => c.id === v.contractorId)?.name || '';
        return (
          v.number.toLowerCase().includes(search) ||
          v.description.toLowerCase().includes(search) ||
          obj.toLowerCase().includes(search) ||
          org.toLowerCase().includes(search)
        );
      });
    }
    items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return json(res, 200, { violations: items });
  }

  const violMatch = pathname.match(/^\/api\/violations\/([^/]+)$/);
  const violNotifyMatch = pathname.match(/^\/api\/violations\/([^/]+)\/notifications$/);
  const violActDocMatch = pathname.match(/^\/api\/violations\/([^/]+)\/act-docx$/);
  const violActPreviewMatch = pathname.match(/^\/api\/violations\/([^/]+)\/act-preview$/);
  const violSendEmailMatch = pathname.match(/^\/api\/violations\/([^/]+)\/send-email$/);
  if (violNotifyMatch && req.method === 'GET') {
    const db = await readDb();
    const v = db.violations.find((x) => x.id === violNotifyMatch[1]);
    if (!v) return json(res, 404, { error: 'Не найдено' });
    if (!permissions.canAccessViolation(dbUser(user), v)) {
      return forbid(res, 'Нет доступа к этому нарушению');
    }
    if (!permissions.can(dbUser(user), 'share')) {
      return forbid(res, 'Отправка уведомлений недоступна для вашей роли');
    }
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const event = u.searchParams.get('event') || 'created';
    const channel = u.searchParams.get('channel') || 'all';
    const ctx = templates.getViolationContext(applyOverdue(v), db, categoriesLib.getCategories(db));
    let push;
    let email;
    if (event === 'report') {
      push = templates.buildPushResolved(ctx, user?.name || 'Исполнитель');
      email = templates.buildEmailResolved(ctx, v.responsible, user?.name);
    } else {
      push = templates.buildPushNew(ctx);
      email = templates.buildEmailAlert(ctx, v.responsible);
    }
    const out = {};
    if (channel === 'all' || channel === 'push') out.push = push;
    if (channel === 'all' || channel === 'email') out.email = email;
    return json(res, 200, out);
  }

  if (violMatch && req.method === 'GET') {
    const db = await readDb();
    const v = db.violations.find((x) => x.id === violMatch[1]);
    if (!v) return json(res, 404, { error: 'Не найдено' });
    if (!permissions.canAccessViolation(dbUser(user), v)) {
      return forbid(res, 'Нет доступа к этому нарушению');
    }
    return json(res, 200, { violation: applyOverdue(v) });
  }

  if (pathname === '/api/violations' && req.method === 'POST') {
    if (!permissions.can(dbUser(user), 'createViolation')) {
      return forbid(res, 'Создание нарушений доступно только аудитору');
    }
    const body = await readBody(req);
    const db = await readDb();
    const obj = db.objects.find((o) => o.id === body.objectId);
    if (!obj) return json(res, 400, { error: 'Объект не найден' });
    const number = nextNumber(db, obj.code);
    const deadline = calcDeadline(body.severity);
    const contractor = db.contractors.find((x) => x.id === body.contractorId);
    const id = 'v' + Date.now();
    let media = [];
    try {
      media = await mediaStore.persistViolationMedia(
        id,
        Array.isArray(body.media) ? body.media : []
      );
    } catch (e) {
      return json(res, 400, { error: e.message || 'Ошибка сохранения фото' });
    }
    const responsibleUserId = String(body.responsibleUserId || '').trim() || null;
    let responsibleName = String(body.responsible || '').trim();
    if (responsibleUserId) {
      const respUser = await usersStore.getUserById(responsibleUserId);
      if (respUser) responsibleName = projectScope.userActPersonName(respUser);
    }
    const v = {
      id,
      number,
      objectId: body.objectId,
      contractorId: body.contractorId,
      categoryId: body.categoryId,
      categoryOther:
        body.categoryId === 'other' ? String(body.categoryOther || body.categoryLabel || '').trim() : '',
      severity: body.severity,
      description: String(body.description || '').trim(),
      status: 'new',
      deadline: deadline.toISOString(),
      createdAt: new Date().toISOString(),
      responsible: responsibleName || contractor?.executor || '—',
      responsibleUserId,
      createdByUserId: user.id,
      createdByName:
        projectScope.userActPersonName(user) ||
        projectScope.userDisplayName(user) ||
        user.name,
      createdByEmail: String(user.email || '').trim(),
      media,
      history: [{ at: new Date().toISOString(), text: 'Нарушение создано', by: user.name }],
      comments: [],
      normRefs: Array.isArray(body.normRefs) && body.normRefs.length
        ? body.normRefs.map((n) => String(n).trim()).filter(Boolean)
        : [],
      locationGps: body.locationGps || null,
    };
    db.violations.unshift(v);
    const isTraining = permissions.isTrainingViolation(v);
    const allUsers = await usersStore.listUsers();
    const linkedUsers = projectScope.findUsersForViolation(db, v, allUsers);
    let emailResult = null;
    let telegramResult = null;
    if (!isTraining) {
      const adminIds = allUsers
        .filter((u) => permissions.normalizeRole(u.role) === 'admin')
        .map((u) => u.id);
      const notifyUserIds = [
        ...new Set([user.id, ...adminIds, responsibleUserId].filter(Boolean)),
      ];
      const generalNotifyIds = responsibleUserId
        ? notifyUserIds.filter((id) => id !== responsibleUserId)
        : notifyUserIds;
    templates.enqueueNotifications(db, v, 'created', {
      userId: user.id,
        notifyUserIds: generalNotifyIds,
      recipientName: v.responsible,
      }, categoriesLib.getCategories(db));
      if (responsibleUserId) {
        templates.enqueueAssigneeNotification(db, v, categoriesLib.getCategories(db), responsibleUserId);
      }

      if (body.sendEmail !== false) {
        const emailPromise = sendViolationEmails(user.id, {
          violation: v,
          db,
          user,
          recipientName: v.responsible,
          recipients: await resolveEmailRecipients({
            violation: v,
            db,
            body,
            linkedUsers,
            creatorUser: user,
          }),
        });
        const emailFast = await Promise.race([
          emailPromise,
          new Promise((resolve) => setTimeout(() => resolve(null), EMAIL_SYNC_TIMEOUT_MS)),
        ]);
        if (emailFast === null) {
          emailResult = {
            sent: false,
            queued: true,
            message: 'Отправка письма запущена в фоне. Если не пришло — попробуйте «Отправить ещё раз».',
          };
          fireAndForget(
            emailPromise.then((r) => {
              console.log('Email background result:', r?.message || r);
            }),
            'email background'
          );
        } else {
          emailResult = emailFast;
        }
      }

      telegramResult = await sendTelegramForViolation(db, user, v, body, 'created', linkedUsers);
      } else {
      emailResult = {
          sent: false,
        skipped: true,
        message: 'Учебный тикет — уведомления не отправляются',
        };
      telegramResult = { sent: false, skipped: true, message: 'Учебный тикет' };
    }

    await writeDb(db);
    return json(res, 201, { violation: v, email: emailResult, telegram: telegramResult });
  }

  if (violMatch && req.method === 'PATCH') {
    const body = await readBody(req);
    const db = await readDb();
    const v = db.violations.find((x) => x.id === violMatch[1]);
    if (!v) return json(res, 404, { error: 'Не найдено' });
    const u = dbUser(user);
    if (!permissions.canAccessViolation(u, v)) {
      return forbid(res, 'Нет доступа к этому нарушению');
    }

    if (body.action === 'status') {
      if (!permissions.can(u, 'editStatus')) {
        return forbid(res, 'Изменение статуса недоступно для вашей роли');
      }
      const order = ['new', 'in_progress', 'verification', 'resolved'];
      const i = order.indexOf(v.status === 'overdue' ? 'in_progress' : v.status);
      v.status = order[Math.min(i + 1, order.length - 1)] || 'in_progress';
      v.history.push({
        at: new Date().toISOString(),
        text: `Статус: ${STATUS_LABELS[v.status]}`,
        by: user.name,
      });
    } else if (body.action === 'comment' && body.text) {
      if (!permissions.can(u, 'comment')) {
        return forbid(res, 'Комментарии недоступны для вашей роли');
      }
      v.comments.push({ at: new Date().toISOString(), text: body.text.trim(), by: user.name });
    } else if (body.action === 'report') {
      if (!permissions.can(u, 'report')) {
        return forbid(res, 'Отправка отчёта недоступна');
      }
      const reportText =
        String(body.text || '').trim() || 'Отчёт об устранении отправлен на проверку';
      let reportMedia = [];
      if (Array.isArray(body.media) && body.media.length) {
        reportMedia = await mediaStore.persistViolationMedia(v.id, body.media);
        v.reportMedia = [...(v.reportMedia || []), ...reportMedia];
      }
      v.comments.push({
        at: new Date().toISOString(),
        text: reportText,
        by: user.name,
        media: reportMedia,
        type: 'report',
      });
      v.status = 'verification';
      v.history.push({
        at: new Date().toISOString(),
        text: reportMedia.length
          ? `Отчёт об устранении (${reportMedia.length} фото) — на проверке`
          : 'Отчёт об устранении отправлен на проверку',
        by: user.name,
      });
      if (!permissions.isTrainingViolation(v)) {
        const allUsers = await usersStore.listUsers();
        let creatorId = v.createdByUserId || null;
        if (!creatorId) {
          const created = (v.history || []).find((h) => h.text === 'Нарушение создано');
          if (created?.by) {
            const match = allUsers.find(
              (u) =>
                projectScope.userDisplayName(u) === created.by ||
                u.email === created.by ||
                `${u.firstName} ${u.lastName}`.trim() === created.by
            );
            creatorId = match?.id || null;
          }
        }
        const adminIds = allUsers
          .filter((u) => permissions.normalizeRole(u.role) === 'admin')
          .map((u) => u.id);
        const notifyUserIds = [...new Set([creatorId, ...adminIds].filter(Boolean))];
      templates.enqueueNotifications(db, v, 'report', {
        userId: user.id,
          notifyUserIds,
        actorName: user.name,
          recipientName: v.createdByName || v.responsible,
        }, categoriesLib.getCategories(db));

        const creator = creatorId ? allUsers.find((u) => u.id === creatorId) : null;
        const reportNotifyUsers = [creator, ...allUsers.filter((u) => adminIds.includes(u.id))].filter(
          Boolean
        );
        if (creator) {
          const ctx = templates.getViolationContext(v, db, categoriesLib.getCategories(db));
          const em = templates.buildEmailResolved(ctx, projectScope.userDisplayName(creator), user.name);
          const creatorEmail = creator.notifyEmail || creator.email;
          if (creatorEmail) {
            await sendEmailAsUser(user.id, {
              recipients: [creatorEmail],
              subject: em.subject,
              text: em.body,
            });
          }
        }
        await sendTelegramForViolation(
          db,
          user,
          v,
          { sendTelegram: true },
          'report',
          reportNotifyUsers
        );
      }
    } else if (body.action === 'append-report-media') {
      if (!permissions.can(u, 'report')) {
        return forbid(res, 'Добавление фото недоступно');
      }
      if (v.status !== 'verification') {
        return json(res, 400, { error: 'Дополнительные фото можно добавить только к отчёту на проверке' });
      }
      let reportMedia = [];
      if (Array.isArray(body.media) && body.media.length) {
        reportMedia = await mediaStore.persistViolationMedia(v.id, body.media);
        v.reportMedia = [...(v.reportMedia || []), ...reportMedia];
      } else {
        return json(res, 400, { error: 'Нет фото для загрузки' });
      }
      v.comments.push({
        at: new Date().toISOString(),
        text: 'Дополнительные фото к отчёту',
        by: user.name,
        media: reportMedia,
        type: 'report',
      });
      v.history.push({
        at: new Date().toISOString(),
        text: `Добавлены фото к отчёту (${reportMedia.length})`,
        by: user.name,
      });
    } else if (body.action === 'reject-report') {
      if (!permissions.can(u, 'editStatus')) {
        return forbid(res, 'Отклонение отчёта недоступно для вашей роли');
      }
      if (v.status !== 'verification') {
        return json(res, 400, { error: 'Отклонить можно только отчёт со статусом «На проверке»' });
      }
      const reason = String(body.text || '').trim();
      if (!reason) {
        return json(res, 400, { error: 'Укажите причину отклонения отчёта' });
      }
      v.comments = v.comments || [];
      v.comments.push({
        at: new Date().toISOString(),
        text: reason,
        by: user.name,
        type: 'reject',
      });
      v.status = isOverdue({ ...v, status: 'in_progress' }) ? 'overdue' : 'in_progress';
      v.history = v.history || [];
      v.history.push({
        at: new Date().toISOString(),
        text: `Отчёт отклонён: ${reason}`,
        by: user.name,
      });
      if (!permissions.isTrainingViolation(v)) {
        const allUsers = await usersStore.listUsers();
        const linkedUsers = projectScope.findUsersForViolation(db, applyOverdue(v), allUsers);
        const recipients = await resolveEmailRecipients({
          violation: v,
          db,
          body: {},
          linkedUsers,
        });
        const ctx = templates.getViolationContext(applyOverdue(v), db, categoriesLib.getCategories(db));
        const mail = templates.buildEmailReportRejected(ctx, v.responsible, reason, user.name);
        if (recipients.length) {
          await sendEmailAsUser(user.id, {
            recipients,
            subject: mail.subject,
            text: mail.body,
          }).catch((e) => console.error('reject-report email:', e.message || e));
        }
        const notifyTargets = linkedUsers.filter(
          (lu) => permissions.normalizeRole(lu.role) === 'contractor' || lu.id === v.createdByUserId
        );
        for (const target of notifyTargets.length ? notifyTargets : linkedUsers.slice(0, 3)) {
          db.notifications = db.notifications || [];
          db.notifications.unshift({
            id: `rj${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
            userId: target.id,
            channel: 'push',
            type: 'report_rejected',
            title: `Отчёт отклонён: №${v.number}`,
            message: reason,
            body: mail.body,
            isRead: false,
            read: false,
            violationId: v.id,
            createdAt: new Date().toISOString(),
            at: new Date().toISOString(),
          });
        }
      }
    } else if (body.status) {
      if (!permissions.can(u, 'editStatus')) {
        return forbid(res, 'Изменение статуса недоступно для вашей роли');
      }
      v.status = body.status;
      v.history.push({
        at: new Date().toISOString(),
        text: `Статус: ${STATUS_LABELS[body.status] || body.status}`,
        by: user.name,
      });
    } else {
      return json(res, 400, { error: 'Unknown action' });
    }
    v.updatedAt = new Date().toISOString();
    await writeDb(db);
    return json(res, 200, { violation: applyOverdue(v) });
  }

  if (violMatch && req.method === 'DELETE') {
    const db = await readDb();
    const id = violMatch[1];
    const v = db.violations.find((x) => x.id === id);
    if (!v) return json(res, 404, { error: 'Не найдено' });
    const isAdmin = user?.role === 'admin';
    const isCreator = !!(v.createdByUserId && user?.id && v.createdByUserId === user.id);
    if (!isAdmin && !isCreator) {
      return forbid(res, 'Удаление доступно автору нарушения или администратору');
    }
    const idx = db.violations.findIndex((x) => x.id === id);
    if (idx < 0) return json(res, 404, { error: 'Не найдено' });
    mediaStore.deleteViolationMedia(id);
    db.violations.splice(idx, 1);
    if (Array.isArray(db.notifications)) {
      db.notifications = db.notifications.filter((n) => n.violationId !== id);
    }
    await writeDb(db);
    return json(res, 200, { ok: true });
  }

  if (pathname === '/api/analytics' && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const db = await readDb();
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const filters = analyticsLib.parseFilters(reqUrl.searchParams);
    const dbU = dbUser(user);
    const isAdmin = dbU && permissions.normalizeRole(dbU.role) === 'admin';
    const viols = permissions.excludeTrainingFromAnalytics(
      isAdmin ? db.violations : permissions.filterViolations(dbU, db.violations)
    );
    const result = analyticsLib.computeAnalytics(db, viols, filters, categoriesLib.getCategories(db), {
      applyOverdue,
      isOverdue,
      isDeadlineCritical: violationCritical.isDeadlineCritical,
    });
    return json(res, 200, result);
  }

  if (pathname === '/api/analytics/export' && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const db = await readDb();
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    const filters = analyticsLib.parseFilters(reqUrl.searchParams);
    filters.includeViolations = true;
    const dbU = dbUser(user);
    const isAdmin = dbU && permissions.normalizeRole(dbU.role) === 'admin';
    const viols = permissions.excludeTrainingFromAnalytics(
      isAdmin ? db.violations : permissions.filterViolations(dbU, db.violations)
    );
    const result = analyticsLib.computeAnalytics(db, viols, filters, categoriesLib.getCategories(db), {
      applyOverdue,
      isOverdue,
      isDeadlineCritical: violationCritical.isDeadlineCritical,
    });
    const csv = analyticsLib.violationsToCsv(result.violations || []);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="victory-check-analytics.csv"',
    });
    res.end(csv);
    return;
  }

  if (pathname === '/api/executors' && req.method === 'GET') {
    const db = await readDb();
    const names = new Set();
    db.contractors.forEach((c) => {
      if (c.executor?.trim()) names.add(c.executor.trim());
    });
    db.violations.forEach((v) => {
      if (v.responsible?.trim()) names.add(v.responsible.trim());
    });
    return json(res, 200, { executors: [...names].sort((a, b) => a.localeCompare(b, 'ru')) });
  }

  if (pathname === '/api/notifications' && req.method === 'GET') {
    const db = await readDb();
    const list = (db.notifications || []).filter(
      (n) => !n.userId || n.userId === user.id
    );
    return json(res, 200, { notifications: list });
  }

  if (pathname === '/api/notifications/read-all' && req.method === 'POST') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const u = dbUser(user);
    if (!u || permissions.normalizeRole(u.role) !== 'admin') {
      return forbid(res, 'Только для администратора');
    }
    const db = await readDb();
    let count = 0;
    for (const n of db.notifications || []) {
      if (!(n.isRead && n.read)) {
        n.read = true;
        n.isRead = true;
        count += 1;
      }
    }
    await writeDb(db);
    return json(res, 200, { ok: true, count });
  }

  const notifIdMatch = pathname.match(/^\/api\/notifications\/([^/]+)$/);
  if (notifIdMatch && req.method === 'PATCH') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const u = dbUser(user);
    if (!u || permissions.normalizeRole(u.role) !== 'admin') {
      return forbid(res, 'Только для администратора');
    }
    const db = await readDb();
    const n = (db.notifications || []).find((x) => x.id === notifIdMatch[1]);
    if (!n) return json(res, 404, { error: 'Уведомление не найдено' });
    const body = await readBody(req);
    if (body.read !== undefined) {
      n.read = !!body.read;
      n.isRead = !!body.read;
    }
    await writeDb(db);
    return json(res, 200, { notification: n });
  }

  if (pathname === '/api/telegram/history' && req.method === 'GET') {
    if (!user) return json(res, 401, { error: 'Требуется авторизация' });
    const db = await readDb();
    const u = dbUser(user);
    const isAdmin = u && permissions.normalizeRole(u.role) === 'admin';
    const list = (db.notifications || [])
      .filter((n) => n.channel === 'telegram')
      .filter((n) => isAdmin || !n.userId || n.userId === user.id)
      .slice(0, 50);
    return json(res, 200, { messages: list });
  }

  if (violActDocMatch && req.method === 'POST') {
    const db = await readDb();
    const v = db.violations.find((x) => x.id === violActDocMatch[1]);
    if (!v) return json(res, 404, { error: 'Не найдено' });
    if (!permissions.canAccessViolation(dbUser(user), v)) {
      return forbid(res, 'Нет доступа к этому нарушению');
    }
    const body = await readBody(req);
    const actOverrides = body && typeof body.actOverrides === 'object' ? body.actOverrides : null;
    const { attachments, error: actError } = await buildViolationEmailAttachments(
      v,
      db,
      user,
      actOverrides
    );
    if (!attachments.length) {
      return json(res, 500, { error: actError || 'Не удалось сформировать акт' });
    }
    const att = attachments[0];
    res.writeHead(200, {
      'Content-Type':
        att.contentType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${att.filename || 'akt-predpisanie.docx'}"`,
    });
    res.end(att.content);
    return;
  }

  if (violActPreviewMatch && req.method === 'GET') {
    const db = await readDb();
    const v = db.violations.find((x) => x.id === violActPreviewMatch[1]);
    if (!v) return json(res, 404, { error: 'Не найдено' });
    if (!permissions.canAccessViolation(dbUser(user), v)) {
      return forbid(res, 'Нет доступа к этому нарушению');
    }
    const ctx = templates.getViolationContext(applyOverdue(v), db, categoriesLib.getCategories(db));
    const { attachments, prescriptionNum, error: actError } = await buildViolationEmailAttachments(
      v,
      db,
      user,
      null
    );
    const act = templates.buildEmailAct(ctx, prescriptionNum);
    return json(res, 200, {
      prescriptionNum,
      subject: act.subject,
      body: act.body,
      fields: {
        description: v.description || '',
        normRefsText: Array.isArray(v.normRefs) ? v.normRefs.join(', ') : '',
        responsible: v.responsible || '',
      },
      meta: {
        number: v.number,
        objectName: ctx.object?.name || '—',
        contractorName: ctx.contractor?.name || '—',
        photoCount: Array.isArray(v.media) ? v.media.length : 0,
      },
      canGenerate: attachments.length > 0,
      actError: actError || null,
    });
  }

  if (violSendEmailMatch && req.method === 'POST') {
    const db = await readDb();
    const v = db.violations.find((x) => x.id === violSendEmailMatch[1]);
    if (!v) return json(res, 404, { error: 'Не найдено' });
    if (!permissions.canAccessViolation(dbUser(user), v)) {
      return forbid(res, 'Нет доступа к этому нарушению');
    }
    if (!permissions.can(dbUser(user), 'share')) {
      return forbid(res, 'Отправка email недоступна для вашей роли');
    }
    const body = await readBody(req);
    const allUsers = await usersStore.listUsers();
    const linkedUsers = projectScope.findUsersForViolation(db, v, allUsers);
    const recipients = await resolveEmailRecipients({ violation: v, db, body, linkedUsers });
    if (!USE_TEMP_EMAIL_RECIPIENT && !recipients.length) {
      return json(res, 400, { error: 'Выберите хотя бы один email получателя' });
    }
    const ctx = templates.getViolationContext(applyOverdue(v), db, categoriesLib.getCategories(db));
    const event = body.event === 'report' ? 'report' : 'created';
    // Предпечать: можно передать правки для акта (description, normRefsText, responsible)
    ctx.actOverrides = body && typeof body.actOverrides === 'object' ? body.actOverrides : null;
    const emailPromise =
      event === 'report'
        ? sendEmailAsUser(user.id, {
      recipients,
            subject: templates.buildEmailResolved(ctx, v.responsible, user?.name).subject,
            text: templates.buildEmailResolved(ctx, v.responsible, user?.name).body,
            attachments: [],
          })
        : sendViolationEmails(user.id, {
            violation: v,
            db,
            user,
            recipientName: v.responsible,
            recipients,
            actOverrides: ctx.actOverrides,
          });
    const emailFast = await Promise.race([
      emailPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), EMAIL_SYNC_TIMEOUT_MS)),
    ]);
    const emailResult =
      emailFast === null
        ? {
            sent: false,
            queued: true,
            message: 'Отправка письма запущена в фоне. Обновите страницу и проверьте почту через 1–2 минуты.',
          }
        : emailFast;
    if (emailFast === null) {
      fireAndForget(
        emailPromise.then((r) => console.log('Email background result:', r?.message || r)),
        'email background'
      );
    }
    const em =
      event === 'report'
        ? templates.buildEmailResolved(ctx, v.responsible, user?.name)
        : templates.buildEmailAlert(ctx, v.responsible);
    return json(res, 200, { ...emailResult, preview: em });
  }

  json(res, 404, { error: 'Not found' });
}

function serveStatic(res, filePath) {
  if (path.extname(filePath).toLowerCase() === '.apk') {
    if (fs.existsSync(filePath)) return serveApkDownload(res, filePath);
    const resolved = resolveApkFile();
    if (resolved) return serveApkDownload(res, resolved);
    res.writeHead(404);
    res.end('APK not found');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function staticRoute(urlPath) {
  if (urlPath === '/' || urlPath === '') {
    return { redirect: '/mobile/', ok: true };
  }
  if (urlPath === '/install-iphone' || urlPath === '/install-iphone.html') {
    return { redirect: '/mobile/install-iphone.html', ok: true };
  }
  if (urlPath === '/download' || urlPath === '/download.html') {
    return { redirect: '/mobile/download.html', ok: true };
  }
  if (urlPath === '/mobile' || urlPath === '/mobile/') {
    return { file: path.join(ROOT, 'victory-check-mobile', 'index.html'), ok: true };
  }
  const mobileRootFiles = new Set([
    'install-iphone.html',
    'download.html',
    'manifest.json',
    'index.html',
  ]);
  const baseName = path.basename(urlPath);
  if (mobileRootFiles.has(baseName)) {
    const file = path.join(ROOT, 'victory-check-mobile', baseName);
    if (file.startsWith(path.join(ROOT, 'victory-check-mobile'))) {
      return { file, ok: true };
    }
  }
  if (urlPath.startsWith('/icons/')) {
    const file = path.join(ROOT, 'victory-check-mobile', urlPath.slice(1));
    if (file.startsWith(path.join(ROOT, 'victory-check-mobile'))) {
      return { file, ok: true };
    }
  }
  if (urlPath === '/admin' || urlPath === '/admin/') {
    return { file: path.join(ROOT, 'victory-check-admin', 'index.html'), ok: true };
  }
  if (urlPath.startsWith('/mobile')) {
    let p = urlPath.replace(/^\/mobile\/?/, '') || 'index.html';
    if (!p.includes('.')) p = 'index.html';
    const file = path.join(ROOT, 'victory-check-mobile', p);
    if (file.startsWith(path.join(ROOT, 'victory-check-mobile'))) return { file, ok: true };
  }
  if (urlPath.startsWith('/admin')) {
    let p = urlPath.replace(/^\/admin\/?/, '') || 'index.html';
    if (!p.includes('.')) p = 'index.html';
    const file = path.join(ROOT, 'victory-check-admin', p);
    if (file.startsWith(path.join(ROOT, 'victory-check-admin'))) return { file, ok: true };
  }
  return { ok: false };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const fwdProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  if (host === 'audit.visural.ru' || fwdProto === 'https' || PUBLIC_PORT === 443) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (process.env.PUBLIC_SCHEME === 'https' && process.env.FORCE_HTTPS_REDIRECT === 'true') {
    const hostHeader = String(req.headers.host || '').trim();
    if (hostHeader) {
      const hostname = hostHeader.split(':')[0].toLowerCase();
      if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
        const fwdProto = String(req.headers['x-forwarded-proto'] || '')
          .split(',')[0]
          .trim()
          .toLowerCase();
        const isHttp = fwdProto ? fwdProto !== 'https' : true;
        if (isHttp) {
          res.writeHead(301, { Location: `https://${hostHeader}${req.url || '/'}` });
          res.end();
          return;
        }
      }
    }
  }

  const u = new URL(req.url, `http://localhost:${PORT}`);
  const rawPathname = u.pathname;
  const pathname = rawPathname.replace(/\/$/, '') || '/';

  try {
    if (pathname.startsWith('/api')) {
      await handleApi(req, res, pathname);
      return;
    }

    if (rawPathname === '/mobile') {
      res.writeHead(301, { Location: '/mobile/' });
      res.end();
      return;
    }
    if (rawPathname === '/admin') {
      res.writeHead(301, { Location: '/admin/' });
      res.end();
      return;
    }

    const route = staticRoute(pathname === '/' ? '/' : pathname);
    if (route.ok) {
      if (route.redirect) {
        res.writeHead(302, { Location: route.redirect });
        res.end();
        return;
      }
      serveStatic(res, route.file);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message || 'Server error' });
  }
});

function logLanUrls() {
  const lanIp = getLanIp();
  const base = publicBaseUrl(PUBLIC_HOST || lanIp);
  if (base) {
    console.log(`  Сайт:    ${base}/mobile/`);
    console.log(`  Админка: ${base}/admin/`);
  } else {
    console.log(`  Телефон: укажите IPv4 в приложении (ipconfig)`);
  }
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nОШИБКА: порт ${PORT} уже занят. Запустите stop.bat на ПК.\n`);
  } else {
    console.error('\nОШИБКА сервера:', e.message || e);
  }
  process.exit(1);
});

usersStore
  .init()
  .then(() => dataStore.init(usersStore.pgEnabled() ? usersStore.getPool() : null))
  .then(() =>
    usersStore.ensureAdminUser({
      email: process.env.VC_ADMIN_EMAIL || 'admin@victory-check.ru',
      password: process.env.VC_ADMIN_PASSWORD || 'VictoryAdmin2026!',
      firstName: process.env.VC_ADMIN_FIRST_NAME || 'Victory',
      lastName: process.env.VC_ADMIN_LAST_NAME || 'Admin',
    })
  )
  .then(() => {
    server.listen(PORT, BIND_HOST, () => {
      const local = publicBaseUrl('localhost') || `http://localhost:${PORT}`;
      const dbMode = usersStore.pgEnabled() ? 'PostgreSQL' : 'db.json';
      console.log(`Victory Check: ${local}`);
      console.log(`  API: http://localhost:${PORT}/api/health (внутренний порт ${PORT})`);
      console.log(`  Хранилище: ${dbMode}`);
  logLanUrls();
  if (telegram.isConfigured()) {
        telegram.startPolling({ readDb, writeDb, usersStore });
        console.log('  Telegram: подключение в фоне');
      }
      setTimeout(() => {
        processDeadlineViolations().catch((e) => console.error('deadline check:', e.message || e));
      }, 15000);
      setInterval(() => {
        processDeadlineViolations().catch((e) => console.error('deadline check:', e.message || e));
      }, 5 * 60 * 1000);
      console.log('  Напоминания о просрочке: каждые 5 мин');
      apkAutoPublish.startWatcher();
    });
  })
  .catch((e) => {
    console.error('Ошибка инициализации БД:', e.message || e);
    process.exit(1);
});
