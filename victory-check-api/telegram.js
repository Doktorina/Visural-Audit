const https = require('https');
const fs = require('fs');
const path = require('path');
const botCommands = require('./telegram-bot');

(function loadTelegramEnv() {
  const priv = path.join(__dirname, 'private', 'telegram.env');
  if (!fs.existsSync(priv)) return;
  fs.readFileSync(priv, 'utf8')
    .split('\n')
    .forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
})();

const API_HOST = 'api.telegram.org';
const API = `https://${API_HOST}`;
/** На серверах с блокировкой домена — прямой IP Telegram DC */
const API_CONNECT_HOST = process.env.TELEGRAM_API_IP || '149.154.167.220';
const OFFSET_FILE = path.join(__dirname, 'data', 'telegram-offset.json');
let updateOffset = 0;
let botCache = null;
let polling = false;
let pollTimer = null;
let dbAccess = null;

try {
  if (fs.existsSync(OFFSET_FILE)) {
    updateOffset = Number(JSON.parse(fs.readFileSync(OFFSET_FILE, 'utf8')).offset) || 0;
  }
} catch (_) {}

function saveOffset() {
  try {
    fs.mkdirSync(path.dirname(OFFSET_FILE), { recursive: true });
    fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset: updateOffset }), 'utf8');
  } catch (_) {}
}

function token() {
  return process.env.TELEGRAM_BOT_TOKEN || '';
}

function isConfigured() {
  const t = token();
  return t.length > 20 && t.includes(':');
}

function httpsTelegramOpts(pathname, method, extraHeaders) {
  return {
    hostname: API_CONNECT_HOST,
    port: 443,
    path: pathname,
    method,
    servername: API_HOST,
    headers: { Host: API_HOST, ...(extraHeaders || {}) },
  };
}

function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) return reject(new Error('Telegram bot not configured'));
    const payload = body ? JSON.stringify(body) : null;
    const pathname = `/bot${token()}/${method}`;
    const headers = payload
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      : {};
    const req = https.request(
      httpsTelegramOpts(pathname, payload ? 'POST' : 'GET', headers),
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(data || '{}');
          } catch {
            json = { ok: false, raw: data };
          }
          if (!json.ok) {
            reject(new Error(json.description || json.raw || `Telegram ${method} failed`));
            return;
          }
          resolve(json.result);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(12000, () => {
      req.destroy();
      reject(new Error('Telegram timeout (set)'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function getBotInfo() {
  if (botCache) return botCache;
  botCache = await tgRequest('getMe');
  return botCache;
}

async function ensurePollingMode() {
  try {
    await tgRequest('deleteWebhook', { drop_pending_updates: false });
  } catch (_) {}
}

async function setupBotCommands() {
  try {
    await tgRequest('setMyCommands', { commands: botCommands.BOT_COMMANDS });
  } catch (e) {
    console.error('Telegram setMyCommands:', e.message);
  }
}

function sendMultipart(method, fields, fileField, filePart) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) return reject(new Error('Telegram bot not configured'));
    const boundary = `----VC${Date.now()}${Math.random().toString(16).slice(2)}`;
    const parts = [];
    Object.entries(fields).forEach(([k, v]) => {
      if (v === undefined || v === null) return;
      parts.push(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`
      );
    });
    const head = Buffer.from(parts.join(''), 'utf8');
    const fileHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"\r\nContent-Type: ${fileField.mime}\r\n\r\n`,
      'utf8'
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const body = Buffer.concat([head, fileHeader, filePart.data, tail]);
    const pathname = `/bot${token()}/${method}`;
    const req = https.request(
      {
        ...httpsTelegramOpts(pathname, 'POST', {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        }),
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          let json = {};
          try {
            json = JSON.parse(data || '{}');
          } catch {
            json = { ok: false, raw: data };
          }
          if (!json.ok) reject(new Error(json.description || json.raw || `${method} failed`));
          else resolve(json.result);
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('Telegram upload timeout'));
    });
    req.write(body);
    req.end();
  });
}

async function sendPhotoFile(chatId, filePath, caption) {
  const fs = require('fs');
  const path = require('path');
  const data = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return sendMultipart(
    'sendPhoto',
    { chat_id: chatId, caption: caption ? String(caption).slice(0, 1024) : undefined },
    { name: 'photo', filename: path.basename(filePath), mime },
    { data }
  );
}

async function sendPhotoBuffer(chatId, buffer, filename, caption) {
  const mime = String(filename).endsWith('.png') ? 'image/png' : 'image/jpeg';
  return sendMultipart(
    'sendPhoto',
    { chat_id: chatId, caption: caption ? String(caption).slice(0, 1024) : undefined },
    { name: 'photo', filename: filename || 'photo.jpg', mime },
    { data: buffer }
  );
}

async function sendViolationPhotos(chatIds, filePaths, captionPrefix) {
  const list = [...new Set((chatIds || []).map(String).filter(Boolean))];
  if (!list.length || !filePaths?.length) return { sent: 0 };
  let sent = 0;
  for (const chatId of list) {
    for (let i = 0; i < filePaths.length && i < 5; i++) {
      try {
        const cap = i === 0 && captionPrefix ? captionPrefix : undefined;
        await sendPhotoFile(chatId, filePaths[i], cap);
        sent++;
      } catch (e) {
        console.error('Telegram photo:', e.message);
      }
    }
  }
  return { sent };
}

async function sendObjectPhotos(chatId, mediaItems) {
  if (!mediaItems?.length) return 0;
  let sent = 0;
  for (const item of mediaItems.slice(0, 10)) {
    try {
      if (item.path) {
        await sendPhotoFile(chatId, item.path, item.caption);
      } else if (item.buffer) {
        await sendPhotoBuffer(chatId, item.buffer, item.filename || 'photo.jpg', item.caption);
      }
      sent++;
    } catch (e) {
      console.error('Telegram object photo:', e.message);
    }
  }
  return sent;
}

async function sendMessage(chatId, text, extra = {}) {
  if (!chatId) return { sent: false, message: 'No chat id' };
  const body = {
    chat_id: chatId,
    text: String(text).slice(0, 4096),
    disable_web_page_preview: true,
    ...extra,
  };
  const result = await tgRequest('sendMessage', body);
  return { sent: true, messageId: result.message_id, message: `Telegram → ${chatId}` };
}

async function answerCallbackQuery(callbackQueryId, text) {
  await tgRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text: text ? String(text).slice(0, 200) : undefined,
    show_alert: false,
  });
}

async function sendMany(chatIds, text, extra = {}) {
  const list = [...new Set((chatIds || []).map(String).filter(Boolean))];
  if (!list.length) return { sent: false, message: 'Нет получателей Telegram' };
  const sentTo = [];
  const errors = [];
  const opts = { reply_markup: extra.reply_markup || botCommands.MENU_KEYBOARD, ...extra };
  for (const id of list) {
    try {
      await sendMessage(id, text, opts);
      sentTo.push(id);
    } catch (e) {
      errors.push(`${id}: ${e.message}`);
    }
  }
  if (sentTo.length) {
    return {
      sent: true,
      message: `Telegram: ${sentTo.length} получ.`,
      recipients: sentTo,
      failed: errors,
    };
  }
  return { sent: false, message: errors.join('; ') || 'Не отправлено', failed: errors };
}

function linkChatFromUpdate(db, chatId, payload) {
  if (!chatId) return { linked: false, userLinked: false };
  let linked = false;
  let userLinked = false;
  db.telegramChats = db.telegramChats || [];
  const id = String(chatId);
  if (!db.telegramChats.includes(id)) {
    db.telegramChats.push(id);
    linked = true;
  }

  const m = String(payload || '').match(/^vc_(.+)$/);
  if (m) {
    const userId = m[1];
    const usersStore = dbAccess?.usersStore;
    if (usersStore?.pgEnabled?.()) {
      usersStore.updateUser(userId, { telegramChatId: id }).catch(() => {});
      linked = true;
      userLinked = true;
    } else {
      const u = db.users?.find((x) => x.id === userId);
      if (u) {
        u.telegramChatId = id;
        linked = true;
        userLinked = true;
      }
    }
  }

  return { linked, userLinked };
}

const botApi = {
  sendMessage,
  answerCallbackQuery,
  linkChatFromUpdate,
  writeDb: null,
  sendViolationPhotos,
  sendObjectPhotos,
};

async function handleUpdate(upd) {
  if (!dbAccess) return 0;
  updateOffset = Math.max(updateOffset, upd.update_id + 1);
  saveOffset();

  botApi.writeDb = dbAccess.writeDb;
  const db = await dbAccess.readDb();
  let handled = 0;

  if (upd.callback_query) {
    try {
      if (await botCommands.handleCallback(upd.callback_query, db, botApi)) handled++;
    } catch (e) {
      console.error('Telegram callback:', e.message);
    }
    return handled;
  }

  const msg = upd.message || upd.edited_message;
  if (!msg?.text) return 0;

  const text = msg.text.trim();
  const chatId = String(msg.chat.id);

  try {
    if (await botCommands.handleCommand(text, chatId, db, botApi)) {
      if (dbAccess.writeDb) await dbAccess.writeDb(db);
      return 1;
    }
  } catch (e) {
    console.error('Telegram command:', e.message);
    try {
      await sendMessage(chatId, `Ошибка: ${e.message}`, { reply_markup: botCommands.MENU_KEYBOARD });
    } catch (_) {}
  }
  return handled;
}

async function fetchUpdates(timeoutSec) {
  const timeout = timeoutSec ?? 25;
  const qs = updateOffset ? `?offset=${updateOffset}&timeout=${timeout}` : `?timeout=${timeout}`;
  const pathname = `/bot${token()}/getUpdates${qs}`;
  return new Promise((resolve, reject) => {
    const req = https.request(httpsTelegramOpts(pathname, 'GET'), (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(data || '{}');
          if (!json.ok) reject(new Error(json.description || 'getUpdates failed'));
          else resolve(json.result || []);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout((timeout + 10) * 1000, () => {
      req.destroy(new Error('getUpdates timeout'));
    });
    req.end();
  });
}

async function pollOnce() {
  if (!isConfigured() || !dbAccess) return { linked: 0, total: 0 };
  if (polling) {
    const db = await dbAccess.readDb();
    return {
      linked: (db.telegramChats || []).length,
      total: 0,
      background: true,
    };
  }
  const updates = await fetchUpdates(1);
  let linked = 0;
  for (const upd of updates) {
    linked += await handleUpdate(upd);
  }
  return { linked, total: updates.length };
}

async function pollLoop() {
  if (!polling || !isConfigured()) return;
  try {
    const updates = await fetchUpdates(25);
    for (const upd of updates) {
      await handleUpdate(upd);
    }
  } catch (e) {
    if (polling) console.error('Telegram poll:', e.message);
  }
  if (polling) pollTimer = setTimeout(pollLoop, 500);
}

function startPolling(access) {
  if (!isConfigured() || polling) return;
  dbAccess = access;
  polling = true;
  ensurePollingMode()
    .then(() => setupBotCommands())
    .then(() => getBotInfo())
    .then((bot) => {
      console.log(`  Telegram: @${bot.username} — /start /list /objects /stats /help`);
      pollLoop();
    })
    .catch((e) => console.error('Telegram init:', e.message));
}

function stopPolling() {
  polling = false;
  if (pollTimer) clearTimeout(pollTimer);
}

async function resolveChatIds(db, userId, body, violation, linkedUsers) {
  const ids = new Set();
  const fromBody = body?.notifyTelegramChatIds || body?.telegramChatIds;
  if (Array.isArray(fromBody)) {
    fromBody.forEach((id) => ids.add(String(id)));
  }
  if (linkedUsers?.length) {
    const projectScope = require('./project-scope');
    projectScope.telegramIdsForUsers(linkedUsers).forEach((id) => ids.add(id));
  }
  let creator = db.users?.find((x) => x.id === userId);
  if (!creator?.telegramChatId && dbAccess?.usersStore) {
    creator = await dbAccess.usersStore.getUserById(userId);
  }
  if (creator?.telegramChatId) ids.add(String(creator.telegramChatId));
  if (!violation) {
    (db.telegramChats || []).forEach((id) => ids.add(String(id)));
    const def = process.env.TELEGRAM_DEFAULT_CHAT_ID;
    if (def) ids.add(String(def));
  }
  return [...ids];
}

module.exports = {
  isConfigured,
  getBotInfo,
  sendMessage,
  sendMany,
  sendViolationNotify: (chatIds, text, violationId) =>
    sendMany(chatIds, text, {
      reply_markup: violationId
        ? { inline_keyboard: [[{ text: '📋 Подробнее', callback_data: `v:${violationId}` }]] }
        : botCommands.MENU_KEYBOARD,
    }),
  pollAndLink: pollOnce,
  startPolling,
  stopPolling,
  resolveChatIds,
  linkChatFromUpdate,
  sendPhotoFile,
  sendViolationPhotos,
  sendObjectPhotos,
};
