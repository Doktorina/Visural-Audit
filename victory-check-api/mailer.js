const fs = require('fs');
const path = require('path');
const tls = require('tls');
const net = require('net');
const https = require('https');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const OUTBOX = path.join(__dirname, 'data', 'outbox');
const COMPANY_FROM_NAME = 'Visural Audit';
const PLACEHOLDER_EMAIL_DOMAINS = new Set([
  'example.ru',
  'example.com',
  'example.org',
  'example.net',
  'test.ru',
  'test.com',
  'localhost',
]);

function primaryMailbox() {
  return String(
    process.env.DEFAULT_NOTIFY_EMAIL || process.env.SMTP_ENVELOPE_FROM || process.env.SMTP_USER || ''
  ).trim();
}

function companyFrom() {
  const raw = (process.env.EMAIL_FROM || '').trim();
  if (raw) return raw;
  const box = primaryMailbox();
  if (box) return `${COMPANY_FROM_NAME} <${box}>`;
  return COMPANY_FROM_NAME;
}

function preferCompanySender() {
  const from = companyFrom().toLowerCase();
  return from.includes('@visural.ru');
}

function isCompanyRecipientEmail(email) {
  const domain = String(email || '').trim().toLowerCase().split('@')[1] || '';
  return domain === 'visural.ru' || domain.endsWith('.visural.ru');
}

function isPlaceholderEmail(email) {
  const addr = String(email || '').trim().toLowerCase();
  if (!addr.includes('@')) return true;
  const domain = addr.split('@')[1];
  return PLACEHOLDER_EMAIL_DOMAINS.has(domain) || domain.endsWith('.local');
}

function shouldUseGmail(userGoogleToken, to) {
  if (preferCompanySender()) return false;
  if (isCompanyRecipientEmail(to)) return false;
  return !!resolveGoogleToken(userGoogleToken);
}

function applyEnvLines(content) {
  content.split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
}

(function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) applyEnvLines(fs.readFileSync(envPath, 'utf8'));
  const priv = path.join(__dirname, 'private');
  if (!fs.existsSync(priv)) return;
  fs.readdirSync(priv).forEach((name) => {
    if (!/\.env$/i.test(name)) return;
    const p = path.join(priv, name);
    if (fs.statSync(p).isFile()) applyEnvLines(fs.readFileSync(p, 'utf8'));
  });
})();

function resendAllowedRecipients() {
  const temp =
    process.env.VC_USE_NORMAL_RECIPIENTS === 'false'
      ? process.env.VC_TEMP_EMAIL_RECIPIENT || primaryMailbox()
      : '';
  const raw =
    process.env.RESEND_ALLOWED_TO ||
    process.env.DEFAULT_NOTIFY_EMAIL ||
    primaryMailbox();
  return [...new Set([raw, temp].join(',').split(/[,;]+/))]
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

function resendAllowedFor(to) {
  if (!resendConfigured()) return false;
  const addr = String(to || '').trim().toLowerCase();
  return resendAllowedRecipients().includes(addr);
}

function resendRelayInbox() {
  const list = resendAllowedRecipients();
  return list[0] || null;
}

function resolveGoogleToken(userToken) {
  return userToken || process.env.GOOGLE_REFRESH_TOKEN || '';
}

function brevoConfigured() {
  const key = process.env.BREVO_API_KEY || '';
  const sender = process.env.BREVO_SENDER_EMAIL || '';
  return key.length > 16 && sender.includes('@');
}

function resendConfigured() {
  const key = process.env.RESEND_API_KEY || '';
  return key.startsWith('re_') && key.length > 10;
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function emailConfigured() {
  return brevoConfigured() || resendConfigured() || smtpConfigured();
}

function canSendToAnyone() {
  return (
    brevoConfigured() ||
    smtpConfigured() ||
    !!resolveGoogleToken() ||
    !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  );
}

function emailProvider() {
  if (smtpConfigured()) return 'smtp';
  if (brevoConfigured()) return 'brevo';
  if (resendConfigured()) return 'resend';
  return null;
}

function buildEml(from, to, subject, text) {
  return buildPlainEml(from, to, subject, text);
}

const { buildPlainEml, buildMimeMessage, normalizeAttachments } = require('./email-mime');

function friendlyEmailError(err) {
  const raw = String(err?.message || err || '').toLowerCase();
  const visuralSmtp = String(process.env.SMTP_HOST || '').toLowerCase().includes('visural');

  if (!smtpConfigured() && !brevoConfigured() && !canSendToAnyone()) {
    return 'Почта на сервере не настроена. Администратору: podklyuchit-pochtu-visural.bat (ящик sec-work@visural.ru).';
  }
  if (raw.includes('login denied') || raw.includes('535') || raw.includes('authentication')) {
    if (visuralSmtp) {
      return 'Ошибка SMTP mail.visural.ru. Запустите podklyuchit-pochtu-visural.bat и проверьте пароль ящика.';
    }
    return 'Ошибка входа SMTP. Проверьте логин и пароль почты.';
  }
  if (raw.includes('only send') || raw.includes('verify') || raw.includes('domain') || raw.includes('resend')) {
    return 'Не удалось отправить письмо. Настройте корпоративную почту: podklyuchit-pochtu-visural.bat';
  }
  if (raw.includes('sender') && raw.includes('not')) {
    return visuralSmtp
      ? 'Проверьте SMTP_USER и пароль в .env (podklyuchit-pochtu-visural.bat).'
      : 'Проверьте адрес отправителя и пароль SMTP.';
  }
  if (raw.includes('invalid api key') || raw.includes('unauthorized') || raw.includes('unrecognised')) {
    return 'Ошибка SMTP. Перенастройте почту: podklyuchit-pochtu-visural.bat';
  }
  if (raw.includes('econnrefused') || raw.includes('enotfound') || raw.includes('timeout')) {
    return 'Нет связи с почтовым сервером mail.visural.ru. Проверьте интернет и настройки SMTP.';
  }
  return 'Не удалось отправить письмо. Попробуйте позже или обратитесь к администратору.';
}

function registrationEmailError(err) {
  const base = friendlyEmailError(err);
  if (base.includes('не настроена') || base.includes('SMTP') || base.includes('связи')) return base;
  return 'Не удалось отправить код на почту. Попробуйте позже или обратитесь к администратору.';
}

function saveToOutbox({ to, subject, text, reason, attachments }) {
  fs.mkdirSync(OUTBOX, { recursive: true });
  const safe = String(to || 'unknown').replace(/[^a-z0-9@._-]/gi, '_');
  const file = path.join(OUTBOX, `${Date.now()}_${safe}.eml`);
  const from = companyFrom();
  const files = normalizeAttachments(attachments);
  fs.writeFileSync(file, buildMimeMessage({ from, to, subject, text, attachments: files }), 'utf8');
  files.forEach((a, i) => {
    const attPath = path.join(OUTBOX, `${Date.now()}_${safe}_att${i}_${a.filename}`);
    fs.writeFileSync(attPath, a.content);
  });
  return {
    sent: false,
    saved: true,
    outboxFile: file,
    attachments: files.length,
    message: reason || 'Почта не настроена. Запустите podklyuchit-pochtu-visural.bat',
  };
}

function httpsJson(method, hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname,
      path,
      method,
      headers: {
        ...headers,
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {}),
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = {};
        try {
          json = JSON.parse(data || '{}');
        } catch {
          json = { raw: data };
        }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function sendViaBrevo({ to, subject, text, attachments }) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL || primaryMailbox();
  const senderName = process.env.BREVO_SENDER_NAME || COMPANY_FROM_NAME;
  const files = normalizeAttachments(attachments);
  const payload = {
    sender: { name: senderName, email: senderEmail },
    to: [{ email: to }],
    subject,
    textContent: text,
  };
  if (files.length) {
    payload.attachment = files.map((f) => ({
      name: f.filename,
      content: f.content.toString('base64'),
    }));
  }
  const { status, json } = await httpsJson(
    'POST',
    'api.brevo.com',
    '/v3/smtp/email',
    { 'api-key': process.env.BREVO_API_KEY },
    payload
  );
  if (status >= 200 && status < 300) {
    return { sent: true, messageId: json.messageId, message: `Письмо отправлено на ${to}` };
  }
  const msg = json.message || json.error || json.code || json.raw || `Brevo error ${status}`;
  throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
}

async function sendViaResend({ to, subject, text, attachments }) {
  const from = companyFrom();
  const list = (Array.isArray(to) ? to : [to]).filter((e) => e && String(e).includes('@'));
  const files = normalizeAttachments(attachments);
  const payload = { from, to: list, subject, text };
  if (files.length) {
    payload.attachments = files.map((f) => ({
      filename: f.filename,
      content: f.content.toString('base64'),
    }));
  }
  const { status, json } = await httpsJson(
    'POST',
    'api.resend.com',
    '/emails',
    { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    payload
  );
  if (status >= 200 && status < 300) {
    return {
      sent: true,
      messageId: json.id,
      message: `Письмо отправлено на ${list.join(', ')}`,
      recipients: list,
    };
  }
  throw new Error(json.message || json.raw || `Resend error ${status}`);
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        socket.off('data', onData);
        socket.off('error', onErr);
        resolve(buf);
      }
    };
    const onErr = (e) => {
      socket.off('data', onData);
      reject(e);
    };
    socket.on('data', onData);
    socket.on('error', onErr);
  });
}

async function smtpCmd(socket, cmd, okPrefix) {
  if (cmd) socket.write(`${cmd}\r\n`);
  const resp = await readSmtpResponse(socket);
  const code = resp.trim().split('\r\n').pop().slice(0, 3);
  if (okPrefix && !okPrefix.includes(code)) {
    throw new Error(`SMTP ${resp.trim().split('\r\n').pop()}`);
  }
  return resp;
}

function connectSmtp(host, port, secure) {
  return new Promise((resolve, reject) => {
    if (secure || port === 465) {
      const socket = tls.connect({ host, port, servername: host }, () => resolve(socket));
      socket.on('error', reject);
      return;
    }
    const socket = net.connect({ host, port }, () => resolve(socket));
    socket.on('error', reject);
  });
}

async function sendViaNativeSmtp({ to, subject, text, attachments }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const envelopeFrom = process.env.SMTP_ENVELOPE_FROM || user || primaryMailbox();
  const from = companyFrom();
  const secure = port === 465 || process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1';

  let socket = await connectSmtp(host, port, secure);
  try {
    await readSmtpResponse(socket);
    await smtpCmd(socket, `EHLO victory-check`, ['250']);
    if (!secure && port === 587) {
      await smtpCmd(socket, 'STARTTLS', ['220']);
      const old = socket;
      socket = tls.connect({ socket: old, servername: host });
      await new Promise((res, rej) => socket.once('secureConnect', res).once('error', rej));
      await smtpCmd(socket, `EHLO victory-check`, ['250']);
    }
    await smtpCmd(socket, 'AUTH LOGIN', ['334']);
    await smtpCmd(socket, Buffer.from(user).toString('base64'), ['334']);
    await smtpCmd(socket, Buffer.from(pass).toString('base64'), ['235']);
    await smtpCmd(socket, `MAIL FROM:<${envelopeFrom}>`, ['250']);
    await smtpCmd(socket, `RCPT TO:<${to}>`, ['250', '251']);
    await smtpCmd(socket, 'DATA', ['354']);
    const body = buildMimeMessage({ from, to, subject, text, attachments });
    socket.write(`${body}\r\n.\r\n`);
    await smtpCmd(socket, null, ['250']);
    await smtpCmd(socket, 'QUIT', ['221']);
  } finally {
    try {
      socket.end();
    } catch (_) {}
  }
  return { sent: true, message: `Письмо отправлено на ${to}` };
}

async function sendViaNodemailer({ to, subject, text, attachments }) {
  const nodemailer = require('nodemailer');
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure =
    process.env.SMTP_SECURE === 'true' || process.env.SMTP_SECURE === '1' || port === 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: process.env.SMTP_TLS_REJECT !== 'false' },
  });
  await transporter.verify();
  const from = companyFrom();
  const envelopeFrom = process.env.SMTP_ENVELOPE_FROM || process.env.SMTP_USER || primaryMailbox();
  const files = normalizeAttachments(attachments);
  const mail = { from, to, subject, text, envelope: { from: envelopeFrom, to } };
  if (files.length) {
    mail.attachments = files.map((f) => ({
      filename: f.filename,
      content: f.content,
      contentType: f.contentType,
    }));
  }
  const info = await transporter.sendMail(mail);
  return { sent: true, messageId: info.messageId, message: `Письмо отправлено на ${to}` };
}

async function sendRelayDigest({ recipients, subject, text, attachments }) {
  const relay = resendRelayInbox();
  if (!relay || !resendConfigured() || !recipients?.length) return null;
  const list = [...new Set(recipients.map((e) => String(e).trim().toLowerCase()))];
  const subj = `[Visural Audit · не доставлено] ${subject}`;
  const body = [
    'Прямая отправка недоступна. Настройте почту: podklyuchit-pochtu-visural.bat',
    '',
    'Получатели:',
    ...list.map((e) => ` • ${e}`),
    '',
    '---',
    '',
    text,
  ].join('\n');
  return sendViaResend({ to: relay, subject: subj, text: body, attachments });
}

async function sendMail({ to, subject, text, attachments, googleRefreshToken: userGoogleToken }) {
  if (!to || !to.includes('@')) {
    return { sent: false, message: 'Укажите корректный email получателя' };
  }

  const gToken = shouldUseGmail(userGoogleToken, to) ? resolveGoogleToken(userGoogleToken) : '';
  if (gToken) {
    try {
      const googleMail = require('./google-mail');
      return await googleMail.sendViaGmail(gToken, { to, subject, text, attachments });
    } catch (e) {
      const msg = String(e.message || e);
      if (!emailConfigured() && !resendAllowedFor(to)) {
        return saveToOutbox({
          to,
          subject,
          text,
          attachments,
          reason: `Gmail: ${msg}. Подключите Gmail в профиле → Уведомления.`,
        });
      }
    }
  }

  if (!emailConfigured()) {
    return saveToOutbox({ to, subject, text, attachments });
  }

  const chain = [];
  if (smtpConfigured()) chain.push(sendViaNodemailer, sendViaNativeSmtp);
  if (brevoConfigured()) chain.push(sendViaBrevo);
  if (resendAllowedFor(to)) chain.push(sendViaResend);

  let lastErr;
  for (const fn of chain) {
    try {
      if (fn === sendViaNodemailer) {
        try {
          require.resolve('nodemailer');
        } catch {
          continue;
        }
      }
      return await fn({ to, subject, text, attachments });
    } catch (e) {
      lastErr = e;
    }
  }

  return saveToOutbox({ to, subject, text, attachments, reason: friendlyEmailError(lastErr) });
}

async function sendMailMany({ recipients, subject, text, attachments, googleRefreshToken: userGoogleToken }) {
  const list = [
    ...new Set((recipients || []).map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes('@'))),
  ];
  if (!list.length) {
    return { sent: false, message: 'Выберите хотя бы один email получателя' };
  }

  const sentTo = [];
  const errors = [];
  const failedAddrs = [];

  for (const to of list) {
    try {
      const r = await sendMail({ to, subject, text, attachments, googleRefreshToken: userGoogleToken });
      if (r.sent) sentTo.push(to);
      else {
        errors.push(`${to}: ${r.message || 'не отправлено'}`);
        failedAddrs.push(to);
      }
    } catch (e) {
      errors.push(`${to}: ${e.message || 'ошибка'}`);
      failedAddrs.push(to);
    }
  }

  const relayed = [];
  if (failedAddrs.length && resendConfigured() && !canSendToAnyone()) {
    try {
      const relay = await sendRelayDigest({ recipients: failedAddrs, subject, text, attachments });
      if (relay?.sent) {
        const inbox = resendRelayInbox();
        failedAddrs.forEach((addr) => {
          relayed.push(addr);
          const idx = errors.findIndex((e) => e.startsWith(`${addr}:`));
          if (idx >= 0) errors.splice(idx, 1);
          if (!sentTo.includes(addr)) sentTo.push(`${addr} (копия → ${inbox})`);
        });
      }
    } catch (_) {}
  }

  if (sentTo.length) {
    let message = `Отправлено: ${sentTo.join(', ')}`;
    if (errors.length) message += `. Ошибки: ${errors.join('; ')}`;
    if (relayed.length && !canSendToAnyone()) {
      message += `. Для доставки всем: .\\setup-free.ps1 или подключите Gmail.`;
    }
    return {
      sent: true,
      message,
      recipients: sentTo,
      failed: errors,
      relayed,
    };
  }

  return {
    sent: false,
    message: errors.join('; ') || 'Не удалось отправить',
    recipients: list,
    failed: errors,
  };
}

async function sendRegistrationMail({ to, firstName, code }) {
  const subject = 'Visural Audit — код подтверждения регистрации';
  const text = [
    `Здравствуйте${firstName ? ', ' + firstName : ''}!`,
    '',
    'Добро пожаловать в Visural Audit — систему фиксации нарушений охраны труда.',
    '',
    `Ваш код подтверждения: ${code}`,
    '',
    'Введите этот код в приложении для завершения регистрации.',
    'Код действует 15 минут.',
  '',
    'Отправитель: sec-work@visural.ru (Visural Audit).',
    'Если письма нет во «Входящих» — откройте папку «Спам».',
    '',
    'Если вы не регистрировались — просто проигнорируйте это письмо.',
    '',
    'Visural Audit',
  ].join('\n');

  if (!smtpConfigured() && !brevoConfigured() && !canSendToAnyone()) {
    return {
      sent: false,
      message: friendlyEmailError(null),
    };
  }

  return sendMail({ to, subject, text });
}

async function sendPasswordResetMail({ to, firstName, code }) {
  const subject = 'Visural Audit — восстановление пароля';
  const text = [
    `Здравствуйте${firstName ? ', ' + firstName : ''}!`,
    '',
    'Вы запросили сброс пароля в Visural Audit.',
    '',
    `Код для нового пароля: ${code}`,
    '',
    'Введите этот код в приложении и задайте новый пароль.',
    'Код действует 15 минут.',
    '',
    'Отправитель: sec-work@visural.ru (Visural Audit).',
    'Если письма нет во «Входящих» — откройте папку «Спам».',
    '',
    'Если вы не запрашивали сброс — просто проигнорируйте это письмо.',
    '',
    'Visural Audit',
  ].join('\n');

  if (!smtpConfigured() && !brevoConfigured() && !canSendToAnyone()) {
    return {
      sent: false,
      message: friendlyEmailError(null),
    };
  }

  return sendMail({ to, subject, text });
}

module.exports = {
  sendMail,
  sendMailMany,
  sendRegistrationMail,
  sendPasswordResetMail,
  smtpConfigured,
  brevoConfigured,
  resendConfigured,
  emailConfigured,
  emailProvider,
  canSendToAnyone,
  resendAllowedFor,
  saveToOutbox,
  friendlySmtpError: friendlyEmailError,
  friendlyEmailError,
  companyFrom,
  preferCompanySender,
  isPlaceholderEmail,
};
