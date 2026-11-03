const https = require('https');
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_SEND = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
function companyFromHeader() {
  return (
    process.env.EMAIL_FROM ||
    (process.env.DEFAULT_NOTIFY_EMAIL
      ? `Visural Audit <${process.env.DEFAULT_NOTIFY_EMAIL}>`
      : 'Visural Audit')
  );
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri(port) {
  const base = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port || 4000}`;
  return `${base.replace(/\/$/, '')}/api/auth/google/callback`;
}

function signState(payload, secret) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

function verifyState(state, secret) {
  const [data, sig] = String(state || '').split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function httpsFormPost(url, body) {
  const params = new URLSearchParams(body).toString();
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data || '{}') });
          } catch {
            resolve({ status: res.statusCode, json: { raw: data } });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(params);
    req.end();
  });
}

function httpsJson(method, url, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          ...headers,
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
            : {}),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(data || '{}') });
          } catch {
            resolve({ status: res.statusCode, json: { raw: data } });
          }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function getAuthUrl(userId, secret, port) {
  const state = signState({ userId, t: Date.now() }, secret);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(port),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code, port) {
  const { status, json } = await httpsFormPost(TOKEN_URL, {
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(port),
    grant_type: 'authorization_code',
  });
  if (status < 200 || status >= 300) {
    throw new Error(json.error_description || json.error || 'Ошибка авторизации Google');
  }
  return json;
}

async function refreshAccessToken(refreshToken) {
  const { status, json } = await httpsFormPost(TOKEN_URL, {
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  if (status < 200 || status >= 300) {
    throw new Error(json.error_description || json.error || 'Сессия Google истекла — подключите снова');
  }
  return json.access_token;
}

const { buildMimeMessage } = require('./email-mime');

function buildRawEmail(to, subject, text, attachments) {
  const from = companyFromHeader();
  const body = buildMimeMessage({ from, to, subject, text, attachments });
  return Buffer.from(body, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendViaGmail(refreshToken, { to, subject, text, attachments }) {
  const accessToken = await refreshAccessToken(refreshToken);
  const raw = buildRawEmail(to, subject, text, attachments);
  const { status, json } = await httpsJson(
    'POST',
    GMAIL_SEND,
    { Authorization: `Bearer ${accessToken}` },
    { raw }
  );
  if (status >= 200 && status < 300) {
    return { sent: true, messageId: json.id, message: `Письмо отправлено через Gmail на ${to}` };
  }
  throw new Error(json.error?.message || json.message || `Gmail API ${status}`);
}

module.exports = {
  isConfigured,
  redirectUri,
  getAuthUrl,
  exchangeCode,
  verifyState,
  sendViaGmail,
};
