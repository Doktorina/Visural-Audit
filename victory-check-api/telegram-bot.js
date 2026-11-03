const templates = require('./templates');
const mediaStore = require('./media-store');

const STATUS_LABELS = {
  new: 'Новое',
  in_progress: 'В работе',
  verification: 'На проверке',
  resolved: 'Устранено',
  overdue: 'Просрочено',
};

const SEVERITY_EMOJI = {
  critical: '🔴',
  major: '🟡',
  minor: '🟢',
  recommendation: '⚪',
};

const CATEGORIES = [
  { id: 'height', name: 'Работа на высоте' },
  { id: 'electro', name: 'Электробезопасность' },
  { id: 'ppe', name: 'СИЗ' },
  { id: 'scaffold', name: 'Строительные леса' },
  { id: 'machinery', name: 'Грузоподъёмные механизмы' },
  { id: 'fire', name: 'Пожарная безопасность' },
  { id: 'ground', name: 'Земляные работы' },
  { id: 'other', name: 'Другое' },
];

const MENU_KEYBOARD = {
  keyboard: [
    [{ text: '📋 Нарушения' }, { text: '📊 Статистика' }],
    [{ text: '🏗 Объекты' }, { text: '🔴 Активные' }],
    [{ text: '🌐 Приложение' }, { text: '❓ Помощь' }],
  ],
  resize_keyboard: true,
};

function appUrl() {
  const host = process.env.PUBLIC_HOST || process.env.PUBLIC_URL || 'audit.visural.ru';
  const port = Number(process.env.PUBLIC_PORT) || Number(process.env.PORT) || 80;
  if (/^https?:\/\//i.test(host)) {
    return `${host.replace(/\/$/, '')}/mobile/`;
  }
  const portPart = port === 80 || port === 443 ? '' : `:${port}`;
  return `http://${host}${portPart}/mobile/`;
}

function applyOverdue(v) {
  if (!v || v.status === 'resolved') return v;
  if (new Date(v.deadline) < new Date() && v.status !== 'verification') {
    return { ...v, status: 'overdue' };
  }
  return v;
}

function getCtx(v, db) {
  return templates.getViolationContext(applyOverdue(v), db, CATEGORIES);
}

function formatViolationLine(v, db) {
  const ctx = getCtx(v, db);
  const sev = SEVERITY_EMOJI[v.severity] || '⚪';
  const st = STATUS_LABELS[v.status] || v.status;
  return `${sev} №${v.number} · ${st}\n${ctx.object?.name || '—'} · ${ctx.contractor?.name || '—'}`;
}

function formatViolationDetail(v, db) {
  const ctx = getCtx(v, db);
  const sev = SEVERITY_EMOJI[v.severity] || '⚪';
  const st = STATUS_LABELS[v.status] || v.status;
  const deadline = new Date(v.deadline).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return [
    `${sev} Нарушение №${v.number}`,
    `Статус: ${st}`,
    `Объект: ${ctx.object?.name || '—'}`,
    `Подрядчик: ${ctx.contractor?.name || '—'}`,
    `Исполнитель: ${v.responsible || '—'}`,
    `Категория: ${ctx.category?.name || '—'}`,
    `Срок: ${deadline}`,
    '',
    `Описание: ${v.description || '—'}`,
    '',
    `Открыть: ${appUrl()}`,
  ].join('\n');
}

function buildStats(db) {
  const items = (db.violations || []).map(applyOverdue);
  const counts = { new: 0, in_progress: 0, verification: 0, resolved: 0, overdue: 0 };
  items.forEach((v) => {
    if (counts[v.status] !== undefined) counts[v.status]++;
  });
  const active = counts.new + counts.in_progress + counts.verification + counts.overdue;
  return [
    '📊 Статистика Visural Check',
    '',
    `Всего: ${items.length}`,
    `Активных: ${active}`,
    '',
    `🆕 Новые: ${counts.new}`,
    `🔧 В работе: ${counts.in_progress}`,
    `🔍 На проверке: ${counts.verification}`,
    `⏰ Просрочено: ${counts.overdue}`,
    `✅ Устранено: ${counts.resolved}`,
  ].join('\n');
}

function buildList(db, filter) {
  let items = (db.violations || []).map(applyOverdue);
  if (filter === 'open') {
    items = items.filter((v) => v.status !== 'resolved');
  }
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const top = items.slice(0, 8);
  if (!top.length) {
    return filter === 'open' ? 'Нет активных нарушений ✅' : 'Нарушений пока нет';
  }
  const title = filter === 'open' ? '🔴 Активные нарушения' : '📋 Последние нарушения';
  const lines = top.map((v) => formatViolationLine(v, db));
  return `${title}\n\n${lines.join('\n\n')}`;
}

function buildObjectButtons(db) {
  const objects = db.objects || [];
  if (!objects.length) return null;
  return {
    inline_keyboard: objects.slice(0, 12).map((o) => {
      const photos = mediaStore.countObjectPhotos(db, o.id);
      const label = `${o.name}`.slice(0, 28) + (photos ? ` (${photos}📷)` : '');
      return [{ text: label, callback_data: `obj:${o.id}` }];
    }),
  };
}

function buildObjectViolationButtons(db, objectId) {
  const items = mediaStore.violationsForObject(db, objectId).slice(0, 8);
  if (!items.length) return null;
  const rows = items.map((v) => [
    {
      text: `№${v.number} (${(v.media || []).length} фото)`,
      callback_data: `v:${v.id}`,
    },
  ]);
  const photos = mediaStore.countObjectPhotos(db, objectId);
  if (photos > 0) {
    rows.push([{ text: `📷 Все фото объекта (${photos})`, callback_data: `objphotos:${objectId}` }]);
  }
  return { inline_keyboard: rows };
}

function buildListButtons(db, filter) {
  let items = (db.violations || []).map(applyOverdue);
  if (filter === 'open') {
    items = items.filter((v) => v.status !== 'resolved');
  }
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const top = items.slice(0, 6);
  if (!top.length) return null;
  return {
    inline_keyboard: top.map((v) => [
      {
        text: `№${v.number}`.slice(0, 40),
        callback_data: `v:${v.id}`,
      },
    ]),
  };
}

function helpText() {
  return [
    '❓ Команды бота Visural Check',
    '',
    '/start — подключить уведомления',
    '/list — последние нарушения',
    '/open — только активные',
    '/stats — статистика',
    '/objects — фото по объектам',
    '/app — ссылка на приложение',
    '/help — эта справка',
    '',
    'Или используйте кнопки меню ниже 👇',
    '',
    'При создании нарушения в приложении с галочкой Telegram — сообщение придёт сюда автоматически.',
  ].join('\n');
}

function normalizeCommand(text) {
  const t = String(text || '').trim();
  const map = {
    '📋 нарушения': '/list',
    '📋 Нарушения': '/list',
    '📊 статистика': '/stats',
    '📊 Статистика': '/stats',
    '🔴 активные': '/open',
    '🔴 Активные': '/open',
    '🏗 объекты': '/objects',
    '🏗 Объекты': '/objects',
    '🌐 приложение': '/app',
    '🌐 Приложение': '/app',
    '❓ помощь': '/help',
    '❓ Помощь': '/help',
  };
  if (map[t]) return map[t];
  const cmd = t.match(/^\/(\w+)/);
  return cmd ? `/${cmd[1].toLowerCase()}` : t;
}

async function handleCommand(text, chatId, db, { sendMessage, linkChatFromUpdate, writeDb }) {
  const cmd = normalizeCommand(text);
  const payload = text.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i)?.[1]?.trim() || '';

  if (cmd.startsWith('/start') || text.startsWith('/start')) {
    const { linked, userLinked } = linkChatFromUpdate(db, chatId, payload);
    if (linked && writeDb) writeDb(db);
    await sendMessage(
      chatId,
      userLinked
        ? '✅ Visural Check\n\nАккаунт привязан. Уведомления о нарушениях будут приходить сюда.'
        : '✅ Visural Check\n\nВы подключены. Новые нарушения из приложения будут приходить сюда.',
      { reply_markup: MENU_KEYBOARD }
    );
    await sendMessage(chatId, helpText(), { reply_markup: MENU_KEYBOARD });
    return true;
  }

  if (cmd === '/help' || cmd === '/помощь') {
    await sendMessage(chatId, helpText(), { reply_markup: MENU_KEYBOARD });
    return true;
  }

  if (cmd === '/list' || cmd === '/нарушения' || cmd === '/violations') {
    const body = buildList(db, 'all');
    const buttons = buildListButtons(db, 'all');
    await sendMessage(chatId, body, {
      reply_markup: buttons || MENU_KEYBOARD,
    });
    return true;
  }

  if (cmd === '/open' || cmd === '/активные') {
    const body = buildList(db, 'open');
    const buttons = buildListButtons(db, 'open');
    await sendMessage(chatId, body, {
      reply_markup: buttons || MENU_KEYBOARD,
    });
    return true;
  }

  if (cmd === '/stats' || cmd === '/статистика') {
    await sendMessage(chatId, buildStats(db), { reply_markup: MENU_KEYBOARD });
    return true;
  }

  if (cmd === '/objects' || cmd === '/объекты') {
    const objects = db.objects || [];
    if (!objects.length) {
      await sendMessage(chatId, 'Объекты не найдены', { reply_markup: MENU_KEYBOARD });
      return true;
    }
    await sendMessage(chatId, '🏗 Выберите объект — покажу нарушения и фото:', {
      reply_markup: buildObjectButtons(db) || MENU_KEYBOARD,
    });
    return true;
  }

  if (cmd === '/app' || cmd === '/приложение') {
    await sendMessage(
      chatId,
      `🌐 Visural Check\n\nОткройте приложение:\n${appUrl()}\n\nВход через сервер — email и пароль из приложения.`,
      {
        reply_markup: {
          inline_keyboard: [[{ text: 'Открыть приложение', url: appUrl() }]],
        },
      }
    );
    return true;
  }

  if (text.startsWith('/')) {
    await sendMessage(
      chatId,
      'Неизвестная команда. Нажмите ❓ Помощь или /help',
      { reply_markup: MENU_KEYBOARD }
    );
    return true;
  }

  return false;
}

async function handleCallback(callback, db, api) {
  const { sendMessage, answerCallbackQuery, sendViolationPhotos, sendObjectPhotos } = api;
  const data = callback.data || '';
  const chatId = String(callback.message?.chat?.id || callback.from?.id);

  if (data.startsWith('objphotos:')) {
    const objectId = data.slice(10);
    const obj = db.objects?.find((o) => o.id === objectId);
    const items = mediaStore.collectObjectMedia(db, objectId, 10);
    await answerCallbackQuery(callback.id);
    if (!items.length) {
      await sendMessage(chatId, 'На этом объекте пока нет сохранённых фото', {
        reply_markup: MENU_KEYBOARD,
      });
      return true;
    }
    await sendMessage(chatId, `📷 ${obj?.name || 'Объект'} — отправляю ${items.length} фото…`, {
      reply_markup: MENU_KEYBOARD,
    });
    if (sendObjectPhotos) await sendObjectPhotos(chatId, items);
    return true;
  }

  if (data.startsWith('obj:')) {
    const objectId = data.slice(4);
    const obj = db.objects?.find((o) => o.id === objectId);
    if (!obj) {
      await answerCallbackQuery(callback.id, 'Объект не найден');
      return true;
    }
    const viols = mediaStore.violationsForObject(db, objectId);
    const photos = mediaStore.countObjectPhotos(db, objectId);
    await answerCallbackQuery(callback.id);
    const text = [
      `🏗 ${obj.name}`,
      obj.address ? `Адрес: ${obj.address}` : '',
      `Нарушений: ${viols.length}`,
      `Фото: ${photos}`,
      '',
      'Выберите нарушение или «Все фото»:',
    ]
      .filter(Boolean)
      .join('\n');
    await sendMessage(chatId, text, {
      reply_markup: buildObjectViolationButtons(db, objectId) || MENU_KEYBOARD,
    });
    return true;
  }

  if (data.startsWith('v:')) {
    const id = data.slice(2);
    const v = db.violations?.find((x) => x.id === id);
    if (!v) {
      await answerCallbackQuery(callback.id, 'Нарушение не найдено');
      return true;
    }
    await answerCallbackQuery(callback.id);
    await sendMessage(chatId, formatViolationDetail(v, db), {
      reply_markup: MENU_KEYBOARD,
    });
    const paths = mediaStore.getViolationMediaPaths(v.media);
    if (paths.length && sendViolationPhotos) {
      await sendViolationPhotos([chatId], paths, `№${v.number}`);
    } else {
      const legacy = mediaStore.collectObjectMedia(db, v.objectId, 10).filter(
        (x) => x.violation?.id === v.id
      );
      if (legacy.length && sendObjectPhotos) await sendObjectPhotos(chatId, legacy);
    }
    return true;
  }
  return false;
}

const BOT_COMMANDS = [
  { command: 'start', description: 'Подключить уведомления' },
  { command: 'list', description: 'Последние нарушения' },
  { command: 'open', description: 'Активные нарушения' },
  { command: 'stats', description: 'Статистика' },
  { command: 'objects', description: 'Фото по объектам' },
  { command: 'app', description: 'Открыть приложение' },
  { command: 'help', description: 'Справка' },
];

module.exports = {
  MENU_KEYBOARD,
  BOT_COMMANDS,
  helpText,
  handleCommand,
  handleCallback,
  formatViolationDetail,
  buildStats,
};
