/**
 * Акт-предписание (DOCX) по образцу — заполнение данными нарушения и фото.
 */
const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const mediaStore = require('./media-store');

const TEMPLATE_PATH = path.join(__dirname, 'templates', 'akt-predpisanie.docx');
const PAGE_BREAK_PARA = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
const PHOTO_PAIR_CX = 3200400;
const PHOTO_PAIR_CY = 2200000;
const PHOTO_GAP_AFTER = 480;
// Линия подписи в одну строку (длинная, на всю ширину таблицы)
const SIG_SHELF = '____________________________________________________________________________________';
const SIG_SHELF_SHORT = '________________________';

const ISSUER_ORG =
  process.env.VC_ISSUER_ORG || 'Общество с ограниченной ответственностью «Виктория Строй»';
const ISSUER_ORG_SHORT = process.env.VC_ISSUER_ORG_SHORT || 'ООО «Виктория Строй»';
const ISSUER_EMAIL = process.env.VC_ISSUER_EMAIL || process.env.DEFAULT_NOTIFY_EMAIL || '';
/** Куда отчитываться об устранении (второй адрес в акте, кроме почты аудитора) */
const ACT_REPORT_SUPERVISOR_EMAIL =
  process.env.VC_ACT_REPORT_SUPERVISOR_EMAIL || 'pasternak@visural.ru';
/** Не подставлять в акт как адрес для отчёта об устранении */
const STALE_REPORT_MAILBOXES = ['sec-work@visural.ru', 'chudinova@visural.ru'];
const ACT_FONT = 'Times New Roman';
/** DOCX: размер в half-points (10 pt = 20) */
const ACT_FONT_SZ = 20;

/** Заглушки в шаблоне DOCX — заменяются на ФИО составителя */
const TEMPLATE_AUDITOR_INITIALS = ['Е.О. Чудинова', 'Е. Чудинова'];
const TEMPLATE_AUDITOR_INSTRUMENTAL = ['Е.О. Чудиновой', 'Е. Чудиновой', 'Елена Олеговна Чудиновой'];

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

function formatDateRu(iso) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDeadlineRu(iso) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function xmlEscape(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDateWordsRu(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]} ${d.getFullYear()}`;
}

/** ФИО: фамилия полностью, имя и отчество — инициалами (Коваленко С.Е.) */
const NAME_STOP_WORDS = new Set([
  'ип',
  'ооо',
  'зао',
  'ао',
  'пао',
  'оао',
  'кому',
  'директору',
  'директор',
  'начальнику',
  'начальник',
  'генеральному',
  'генеральный',
  'исполнительному',
  'ответственному',
  'руководителю',
  'руководитель',
]);

function isInitialsToken(word) {
  const w = String(word || '').trim();
  if (!w) return false;
  if (/^[А-ЯЁA-Z](\.[А-ЯЁA-Z])+\.?$/.test(w)) return true;
  return /^([А-ЯЁA-Z]\.){1,3}$/.test(w);
}

function lettersFromInitialsToken(token) {
  return [...String(token || '').matchAll(/[А-ЯЁA-Z]/gi)].map((m) => m[0].toUpperCase());
}

function parseInitialsToken(token) {
  const letters = lettersFromInitialsToken(token);
  return {
    firstName: letters[0] || '',
    middleName: letters[1] || '',
  };
}

function sanitizePersonNameParts(raw) {
  const parts = String(raw || '')
    .trim()
    .replace(/[«»"""']/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((p) => !NAME_STOP_WORDS.has(p.toLowerCase().replace(/\./g, '')));
  for (let i = parts.length - 2; i >= 0; i--) {
    if (isLikelyRussianSurname(parts[i]) && isInitialsToken(parts[i + 1])) {
      return parts.slice(i);
    }
  }
  return parts;
}

function isLikelyRussianPatronymic(word) {
  const w = String(word || '').trim();
  return /(?:ович|евич|овна|евна|ична|ич)(у|е|ой|ому)?$/i.test(w);
}

function isLikelyRussianSurname(word) {
  const w = String(word || '').trim();
  if (isLikelyRussianPatronymic(w)) return false;
  return /(?:ов|ев|ин|ова|ева|ина|ский|цкий|ко|юк|енко|ян|янц|нак|ак|юк|ич)$/i.test(w);
}

function isLikelyRussianFirstName(word) {
  const w = String(word || '').trim();
  if (!/^[А-ЯЁ][а-яё]+$/.test(w)) return false;
  if (isLikelyRussianSurname(w)) return false;
  return /[аяеиоую]$/i.test(w);
}

function stripDativeEnding(word) {
  const w = String(word || '').trim();
  // Только дательный «…у» (Рябкову → Рябков). Не трогаем «…о» (Коваленко, Петренко).
  if (!w || w.length < 4 || !/у$/i.test(w)) return w;
  const stem = w.slice(0, -1);
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(stem)) return stem;
  return w;
}

function formatSpecialistParts(lastName, firstName, middleName) {
  lastName = stripDativeEnding(lastName);
  firstName = stripDativeEnding(firstName);
  middleName = stripDativeEnding(middleName);
  const inits = [firstName, middleName]
    .filter(Boolean)
    .map((p) => `${String(p).charAt(0).toUpperCase()}.`);
  const initialsCompact = inits.join('');
  const fio = [lastName, firstName, middleName].filter(Boolean).join(' ');
  return {
    fio,
    initials: `${lastName} ${initialsCompact}`.trim(),
    instrumental: `${lastName} ${initialsCompact}`.trim(),
  };
}

function parseRussianPersonName(raw) {
  const parts = sanitizePersonNameParts(raw);
  if (!parts.length) return { lastName: '', firstName: '', middleName: '' };
  if (parts.length === 1) {
    if (isInitialsToken(parts[0])) {
      const { firstName, middleName } = parseInitialsToken(parts[0]);
      return { lastName: '', firstName, middleName };
    }
    return { lastName: parts[0], firstName: '', middleName: '' };
  }

  const lastPart = parts[parts.length - 1];
  const firstPart = parts[0];

  if (parts.length === 2 && isLikelyRussianSurname(firstPart) && isInitialsToken(lastPart)) {
    const { firstName, middleName } = parseInitialsToken(lastPart);
    return { lastName: firstPart, firstName, middleName };
  }

  if (isLikelyRussianSurname(lastPart)) {
    let i = 0;
    while (i < parts.length - 1 && isInitialsToken(parts[i])) i++;
    if (i > 0 && i === parts.length - 1) {
      const letters = parts.slice(0, i).flatMap(lettersFromInitialsToken);
      return {
        lastName: lastPart,
        firstName: letters[0] || '',
        middleName: letters[1] || '',
      };
    }
  }

  let lastIdx = -1;

  if (parts.length >= 3 && isLikelyRussianSurname(lastPart) && !isLikelyRussianPatronymic(lastPart)) {
    lastIdx = parts.length - 1;
  } else if (isLikelyRussianSurname(firstPart) && !isLikelyRussianPatronymic(firstPart)) {
    lastIdx = 0;
  } else if (
    parts.length >= 2 &&
    isLikelyRussianFirstName(firstPart) &&
    isLikelyRussianSurname(parts[1]) &&
    !isLikelyRussianPatronymic(parts[1])
  ) {
    lastIdx = 1;
  } else if (isLikelyRussianSurname(lastPart) && !isLikelyRussianPatronymic(lastPart)) {
    lastIdx = parts.length - 1;
  } else {
    lastIdx = 0;
  }

  const lastName = parts[lastIdx];
  const rest = parts.filter((_, idx) => idx !== lastIdx);
  if (rest.length === 1 && isInitialsToken(rest[0])) {
    const { firstName, middleName } = parseInitialsToken(rest[0]);
    return { lastName, firstName, middleName };
  }
  if (rest.length >= 1 && rest.every(isInitialsToken)) {
    const letters = rest.flatMap(lettersFromInitialsToken);
    return {
      lastName,
      firstName: letters[0] || '',
      middleName: letters[1] || '',
    };
  }
  const firstName = rest[0] || '';
  const middleName = rest.length > 1 ? rest.slice(1).join(' ') : '';
  return { lastName, firstName, middleName };
}

function personNameFromUser(user) {
  if (!user) return { lastName: '', firstName: '', middleName: '' };
  const composite = [
    user.firstName,
    user.middleName || user.patronymic,
    user.lastName,
  ]
    .map((p) => String(p || '').trim())
    .filter(Boolean)
    .join(' ');
  const raw =
    String(user.fullName || user.name || '').trim() ||
    composite;
  const parsed = parseRussianPersonName(raw);
  if (parsed.lastName && parsed.firstName && !isLikelyRussianPatronymic(parsed.lastName)) {
    return parsed;
  }
  const lastName = String(user.lastName || '').trim();
  const firstName = String(user.firstName || '').trim();
  const middleName = String(user.middleName || user.patronymic || '').trim();
  if (lastName && firstName && !lastName.includes(' ') && !isLikelyRussianPatronymic(lastName)) {
    return { lastName, firstName, middleName };
  }
  return parsed;
}

function isPlausibleParsedName(parsed) {
  return !!(
    parsed?.lastName &&
    parsed?.firstName &&
    !isLikelyRussianPatronymic(parsed.lastName) &&
    !String(parsed.lastName).includes(' ')
  );
}

function formatSpecialistFromUser(user, fallbackName) {
  const fb = String(fallbackName || '').trim();
  if (fb) {
    const fromFallback = parseRussianPersonName(fb);
    if (isPlausibleParsedName(fromFallback)) {
      return formatSpecialistParts(fromFallback.lastName, fromFallback.firstName, fromFallback.middleName);
    }
  }
  if (user) {
    const fromUser = personNameFromUser(user);
    if (isPlausibleParsedName(fromUser)) {
      return formatSpecialistParts(fromUser.lastName, fromUser.firstName, fromUser.middleName);
    }
  }
  return formatSpecialist(fb || specialistNameFromUser(user));
}

function resolveActAuthorUser(user, violation, ctx = {}) {
  const users = ctx?.db?.users || [];
  if (violation?.createdByUserId && users.length) {
    const creator = users.find((u) => u.id === violation.createdByUserId);
    if (creator) return creator;
  }
  return user;
}

function formatSpecialist(fullName) {
  const raw = String(fullName || '').trim();
  if (!raw) {
    return { fio: '—', initials: '—', instrumental: '—' };
  }
  const { lastName, firstName, middleName } = parseRussianPersonName(raw);
  if (!lastName && !firstName) {
    return { fio: raw, initials: raw, instrumental: raw };
  }
  if (!firstName) {
    return { fio: lastName, initials: lastName, instrumental: lastName };
  }
  return formatSpecialistParts(lastName, firstName, middleName);
}

function formatActPersonName(raw) {
  return formatSpecialist(raw).initials;
}

const DEFAULT_JOB_TITLE = 'Специалист службы охраны труда';

function resolveJobTitle(user) {
  return String(user?.jobTitle || user?.job_title || '').trim() || DEFAULT_JOB_TITLE;
}

function jobTitleInstrumental(title) {
  const t = String(title || '').trim() || DEFAULT_JOB_TITLE;
  if (/^Специалист\s/i.test(t) && !/^Специалистом/i.test(t)) {
    return t.replace(/^Специалист/i, 'Специалистом');
  }
  if (/^Инженер\s/i.test(t) && !/^Инженером/i.test(t)) {
    return t.replace(/^Инженер/i, 'Инженером');
  }
  return t;
}

function specialistNameFromUser(user) {
  if (!user) return '';
  const fromParts = [user.lastName, user.firstName, user.middleName || user.patronymic]
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (fromParts.length >= 2) return fromParts.join(' ');
  const full = String(user.fullName || user.name || '').trim();
  return full;
}

function isSystemMailbox(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return true;
  const blocked = new Set(
    [
      ...STALE_REPORT_MAILBOXES,
      ISSUER_EMAIL,
      process.env.DEFAULT_NOTIFY_EMAIL,
      process.env.SMTP_USER,
      process.env.VC_ISSUER_EMAIL,
    ]
      .map((x) => String(x || '').trim().toLowerCase())
      .filter(Boolean)
  );
  return blocked.has(e);
}

function pickUserActEmail(user) {
  if (!user) return '';
  for (const raw of [user.email, user.notifyEmail]) {
    const email = String(raw || '').trim();
    if (email && !isSystemMailbox(email)) return email;
  }
  return '';
}

function resolveReportEmails(ctx, violation) {
  const users = ctx.db?.users || [];
  let auditorEmail = '';

  if (violation?.createdByUserId && users.length) {
    const creator = users.find((u) => u.id === violation.createdByUserId);
    auditorEmail = pickUserActEmail(creator);
  }
  if (!auditorEmail) {
    const fromViol = String(violation?.createdByEmail || '').trim();
    if (fromViol && !isSystemMailbox(fromViol)) auditorEmail = fromViol;
  }
  if (!auditorEmail && ctx.user) {
    auditorEmail = pickUserActEmail(ctx.user);
  }

  const supervisor = String(ACT_REPORT_SUPERVISOR_EMAIL || '').trim();
  const list = [...new Set([auditorEmail, supervisor].filter((e) => e && !isSystemMailbox(e)))];
  return list.length ? list.join(', ') : supervisor || '—';
}

function scrubStaleReportMailboxes(xml, reportEmails) {
  let out = xml;
  const keep = new Set(
    String(reportEmails || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  for (const stale of STALE_REPORT_MAILBOXES) {
    if (keep.has(stale.toLowerCase())) continue;
    out = out.split(stale).join('');
  }
  return out;
}

function reportEmailsPhrase(reportEmails) {
  const emails = String(reportEmails || '').trim();
  if (!emails) return 'на электронный адрес: —';
  const count = emails.split(',').map((s) => s.trim()).filter(Boolean).length;
  return count > 1
    ? `на электронные адреса: ${emails}`
    : `на электронный адрес: ${emails}`;
}

function resolveActAuthorName(user, violation, ctx = {}) {
  const fromViolation = String(violation?.createdByName || '').trim();
  const fromUser = specialistNameFromUser(user);
  const fromCtx = String(ctx.createdByName || '').trim();
  return fromViolation || fromUser || fromCtx || '';
}

function replaceAuditorPlaceholders(xml, specialist) {
  let out = xml;
  for (const placeholder of TEMPLATE_AUDITOR_INITIALS) {
    out = out.split(placeholder).join(specialist.initials);
  }
  for (const placeholder of TEMPLATE_AUDITOR_INSTRUMENTAL) {
    out = out.split(placeholder).join(specialist.instrumental);
  }
  return out;
}

function instrumentalSurname(lastName) {
  const n = String(lastName || '').trim();
  if (!n) return n;
  if (/[ая]$/.test(n)) return `${n.slice(0, -1)}${n.endsWith('я') ? 'ей' : 'ой'}`;
  if (/ий$/.test(n)) return `${n.slice(0, -2)}им`;
  if (/ый$/.test(n)) return `${n.slice(0, -2)}ым`;
  return n;
}

function prescriptionNumber(violation, db) {
  if (violation.prescriptionNumber) return String(violation.prescriptionNumber);
  const m = String(violation.number || '').match(/(\d+)\s*$/);
  if (m) return m[1];
  const n = (db?.violations || []).length;
  return String(n || 1);
}

function objectLine(object) {
  if (!object) return '—';
  const name = object.name || '—';
  const addr = String(object.address || '').trim();
  return addr ? `${name} по адресу: ${addr}` : name;
}

function resolveResponsibleUser(violation, db) {
  const users = db?.users || [];
  if (!users.length || !violation) return null;
  if (violation.responsibleUserId) {
    const byId = users.find((u) => u.id === violation.responsibleUserId);
    if (byId) return byId;
  }
  const name = String(violation.responsible || '').trim();
  if (!name) return null;
  return (
    users.find((u) => {
      const display = specialistNameFromUser(u) || String(u.name || '').trim();
      return display === name || String(u.name || '').trim() === name;
    }) || null
  );
}

function resolveActRecipientUser(contractor, violation, db) {
  if (contractor && db) {
    try {
      const ps = require('./project-scope');
      const head = ps.resolveContractorHeadUser(contractor, db, db.users);
      if (head) return head;
    } catch (_) {}
  }
  return resolveResponsibleUser(violation, db);
}

function jobTitleDative(title) {
  const t = String(title || '').trim();
  if (!t) return 'Ответственному';
  if (/(нику|тору|еру|ому|ей)$/i.test(t.split(/\s+/).pop() || '')) return t;
  if (/^Директор/i.test(t)) return t.replace(/^Директор/i, 'Директору');
  if (/^Начальник/i.test(t)) return t.replace(/^Начальник/i, 'Начальнику');
  if (/^Инженер/i.test(t)) return t.replace(/^Инженер/i, 'Инженеру');
  if (/^Специалист/i.test(t)) return t.replace(/^Специалист/i, 'Специалисту');
  if (/^Руководитель/i.test(t)) return t.replace(/^Руководитель/i, 'Руководителю');
  if (/^Аудитор/i.test(t)) return t.replace(/^Аудитор/i, 'Аудитору');
  return t;
}

function resolveRecipientJobTitle(user) {
  const t = String(user?.jobTitle || user?.job_title || '').trim();
  return t || 'Директор';
}

function formatPersonShortFio(user, fallbackName) {
  return formatSpecialistFromUser(user, fallbackName).initials;
}

function resolveRecipientPersonShort(violation, contractor, db) {
  const recipientUser = resolveActRecipientUser(contractor, violation, db);
  if (recipientUser) {
    const parsed = personNameFromUser(recipientUser);
    if (parsed.lastName && parsed.firstName) {
      return formatSpecialistParts(parsed.lastName, parsed.firstName, parsed.middleName).initials;
    }
  }
  const raw = String(contractor?.executor || violation?.responsible || '').trim();
  if (!raw) return '';
  return formatSpecialist(raw).initials;
}

function recipientLine(contractor, violation, db) {
  const org = contractor?.name || '—';
  const person = resolveRecipientPersonShort(violation, contractor, db);
  const recipientUser = resolveActRecipientUser(contractor, violation, db);
  const titleDative = jobTitleDative(resolveRecipientJobTitle(recipientUser));
  if (person) return `${titleDative} ${org} ${person}`;
  return `${titleDative} ${org}`;
}

function recipientLineShort(contractor, violation, db) {
  const person = resolveRecipientPersonShort(violation, contractor, db);
  const recipientUser = resolveActRecipientUser(contractor, violation, db);
  const titleDative = jobTitleDative(resolveRecipientJobTitle(recipientUser));
  if (person) return `${titleDative}  ${person}`;
  return titleDative;
}

function normsLine(normRefs) {
  const list = (normRefs || []).map((n) => String(n).trim()).filter(Boolean);
  if (!list.length) return '—';
  return list.map((n) => (n.toLowerCase().startsWith('нарушение') ? n : `Нарушение ${n}`)).join('; ');
}

function normsPrescriptionLine(normRefs) {
  const list = (normRefs || []).map((n) => String(n).trim()).filter(Boolean);
  if (!list.length) return '—';
  const text = list
    .map((n) => n.replace(/^нарушение\s+/i, '').replace(/[«»]/g, '').trim())
    .join('; ');
  return text.replace(/ /g, '\u00A0');
}

function loadPhotoBuffers(media) {
  const items = [];
  for (const m of media || []) {
    const fp = mediaStore.resolveFilePath(m);
    if (fp && fs.existsSync(fp)) {
      items.push({
        filename: path.basename(fp),
        buffer: fs.readFileSync(fp),
        mime: mediaStore.mimeForFile(fp),
      });
      continue;
    }
    const s = String(m || '');
    const parsed = s.startsWith('data:image/') ? parseDataUrl(s) : null;
    if (parsed) {
      items.push({
        filename: `photo${parsed.ext}`,
        buffer: parsed.buf,
        mime: parsed.mime,
      });
    }
  }
  return items;
}

function parseDataUrl(dataUrl) {
  const m = String(dataUrl).match(/^data:(image\/[\w+.-]+);base64,(.+)$/s);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  let ext = '.jpg';
  if (mime.includes('png')) ext = '.png';
  else if (mime.includes('webp')) ext = '.webp';
  return { buf: Buffer.from(m[2], 'base64'), ext, mime };
}

function replaceAll(xml, pairs) {
  let out = xml;
  for (const [from, to] of pairs) {
    if (!from) continue;
    out = out.split(from).join(xmlEscape(to));
  }
  return out;
}

function buildReplacements(ctx, specialist) {
  const jobTitle = specialist.jobTitle || DEFAULT_JOB_TITLE;
  const jobTitleInst = specialist.jobTitleInst || jobTitleInstrumental(jobTitle);
  const { violation, object, contractor, categoryFull, prescriptionNum } = ctx;
  const actDate = formatDateRu(violation.createdAt);
  const actDateWords = formatDateWordsRu(violation.createdAt);
  const deadline = formatDeadlineRu(violation.deadline);
  const photoCount = Array.isArray(violation.media) ? violation.media.length : 0;
  const dbRef = ctx.db || {};
  const responsible = formatPersonShortFio(
    resolveActRecipientUser(contractor, violation, dbRef),
    contractor?.executor || violation.responsible || '—'
  );
  const orgName = contractor?.name || '—';
  const recipientFull = recipientLine(contractor, violation, dbRef);
  const recipientShort = recipientLineShort(contractor, violation, dbRef);
  const location = object?.name || categoryFull || '—';
  const reportEmails = resolveReportEmails(ctx, violation);
  const reportPhrase = reportEmailsPhrase(reportEmails);

  return [
    ['Общество с ограниченной ответственностью «Виктория Строй»', ISSUER_ORG],
    ['ООО «Виктория Строй»', ISSUER_ORG_SHORT],
    ['№40 от 30.04.2026', `№${prescriptionNum} от ${actDate}`],
    [
      'Объект строительства: Завод «Уральские локомотивы» по адресу: г. Верхняя Пышма, ул. Парковая,36',
      `Объект строительства: ${objectLine(object)}`,
    ],
    [
      'Завод «Уральские локомотивы» по адресу: г. Верхняя Пышма, ул. Парковая,36',
      objectLine(object),
    ],
    [
      'Завод «Уральские локомотивы» по адресу: г. Верхняя Пышма, ул. Парковая, 36.',
      objectLine(object),
    ],
    ['Директору ООО «АКЦЕНТ-КОМПЛЕКТ» Рябкову Ивану Николаевичу', recipientFull],
    ['ООО «АКЦЕНТ-КОМПЛЕКС»', orgName],
    ['ООО «АКЦЕНТ-КОМПЛЕКТ»', orgName],
    ['ООО «АКЦЕНТ-КОМПЛЕКТ».', `${orgName}.`],
    [`Кому    ООО «АКЦЕНТ-КОМПЛЕКТ» `, `Кому    ${orgName} `],
    ['директору  Рябкову Ивану Николаевичу', recipientShort],
    ['Рябкову Ивану Николаевичу', responsible],
    [
      'Специалистом службы охраны труда ООО «Виктория Строй» Е.О. Чудиновой, проведена проверка соблюдения требований охраны труда, промышленной и пожарной безопасности,',
      `${jobTitleInst} ${ISSUER_ORG_SHORT} ${specialist.instrumental}, проведена проверка соблюдения требований охраны труда, промышленной и пожарной безопасности,`,
    ],
    ['Специалист службы охраны труда', jobTitle],
    ['Е.О. Чудиновой', specialist.instrumental],
    ['Е.О. Чудинова', specialist.initials],
    ['Е. Чудиновой', specialist.instrumental],
    ['Е. Чудинова', specialist.initials],
    [
      'Работник, осуществляющий работы с использованием вышки-туры на высоте 1,8 метра и более, не применяет средства индивидуальной защиты от падения с высоты при отсутствии соответствующего защитного ограждения.',
      violation.description || '—',
    ],
    [
      'Нарушение ст. 3, 6 «Правил по охране труда при работе на высоте».',
      normsLine(violation.normRefs),
    ],
    ['Конструкторское бюро', location],
    ['с момента получения предписания', deadline],
    [`фотографии 4 шт.`, `фотографии ${photoCount} шт.`],
    ['chudinova@visural.ru', reportEmails],
    ['sec-work@visural.ru', reportEmails],
    ['на электронный адрес: chudinova@visural.ru', reportPhrase],
    ['на электронный адрес: sec-work@visural.ru', reportPhrase],
    ['на электронные адреса: chudinova@visural.ru', reportPhrase],
    ['на электронные адреса: sec-work@visural.ru', reportPhrase],
    ['30 апреля 2026', actDateWords],
    ['05.05.2026', actDate],
    ['Акт проверки № 40', `Акт проверки № ${prescriptionNum}`],
    [
      'Приложение №1 к акту проверки № 40 от 30 апреля 2026',
      `Приложение №1 к акту проверки № ${prescriptionNum} от ${actDateWords}`,
    ],
    [
      'Правил по охране труда при работе на высоте»______________________',
      `${normsPrescriptionLine(violation.normRefs)}»${SIG_SHELF}`,
    ],
    ['«Правил по охране труда при работе на высоте»', normsLine(violation.normRefs)],
    ['№  40', `№  ${prescriptionNum}`],
    ['Акт проверки№40', `Акт проверки №${prescriptionNum}`],
    ['[фото]', ''],
  ];
}

function textPara(text, opts = {}) {
  const { center = false, underline = false, size = ACT_FONT_SZ } = opts;
  const jc = center ? '<w:jc w:val="center"/>' : '';
  const u = underline ? '<w:u w:val="single"/>' : '';
  return `<w:p><w:pPr>${jc}</w:pPr><w:r><w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${u}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function shelfPara(center = true) {
  return textPara(SIG_SHELF, { center });
}

function cellOneLine(text, size = ACT_FONT_SZ, center = true) {
  const jc = center ? '<w:jc w:val="center"/>' : '';
  return `<w:p><w:pPr>${jc}</w:pPr><w:r><w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function mergedShelfRow(trPrXml = '', text = SIG_SHELF) {
  return `<w:tr>${trPrXml}<w:tc><w:tcPr><w:gridSpan w:val="4"/></w:tcPr>${cellOneLine(text, ACT_FONT_SZ)}</w:tc></w:tr>`;
}

function dateRowFromLabels(trXml, actDate) {
  const cells = trXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
  const trPr = trXml.match(/<w:trPr>[\s\S]*?<\/w:trPr>/);
  const newCells = [0, 1, 2, 3].map((i) => {
    const tcPr = (cells[i] || '').match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
    const text = i === 1 ? `${actDate} г.` : '';
    return `<w:tc>${tcPr ? tcPr[0] : ''}${cellOneLine(text)}</w:tc>`;
  });
  return `<w:tr>${trPr ? trPr[0] : ''}${newCells.join('')}</w:tr>`;
}

function labelsRow(trXml) {
  const labels = ['(должность)', '(дата)', '(подпись)', '(инициалы, фамилия)'];
  const cells = trXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
  const trPr = trXml.match(/<w:trPr>[\s\S]*?<\/w:trPr>/);
  const newCells = labels.map((label, i) => {
    const tcPr = (cells[i] || '').match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/);
    return `<w:tc>${tcPr ? tcPr[0] : ''}${cellOneLine(label)}</w:tc>`;
  });
  return `<w:tr>${trPr ? trPr[0] : ''}${newCells.join('')}</w:tr>`;
}

function rebuildSignatureTable(tableXml, specialist, actDate) {
  let rows = (tableXml.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || []).map((r) =>
    replaceAuditorPlaceholders(r, specialist)
  );
  if (!rows.length) return tableXml;

  const titleRowIdx = rows.findIndex((r) => /службы охраны труда|охраны труда/i.test(r));
  const actReceivedIdx = rows.findIndex((r) => r.includes('Акт проверки получил'));
  const labelIdx = rows.findIndex(
    (r) => r.includes('(должность)') && r.includes('(инициалы, фамилия)')
  );

  if (titleRowIdx < 0 || actReceivedIdx < 0 || labelIdx < 0) {
    return tableXml.replace(/_{20,}/g, SIG_SHELF);
  }

  const jobTitle = specialist.jobTitle || DEFAULT_JOB_TITLE;
  let titleRow = rows[titleRowIdx];
  if (jobTitle !== DEFAULT_JOB_TITLE) {
    titleRow = titleRow
      .split('Специалист службы охраны труда')
      .join(jobTitle)
      .split(DEFAULT_JOB_TITLE)
      .join(jobTitle);
  }

  let actReceivedRow = rows[actReceivedIdx].replace(/_{5,}/g, '');
  const labelRow = rows[labelIdx];
  const trPrLabel = labelRow.match(/<w:trPr>[\s\S]*?<\/w:trPr>/);

  const rebuiltRows = [
    titleRow,
    actReceivedRow,
    mergedShelfRow(trPrLabel ? trPrLabel[0] : '', SIG_SHELF),
    labelsRow(labelRow),
  ];

  const tableHeaderMatch = tableXml.match(/^<w:tbl>([\s\S]*?)<w:tr>/);
  const tableHeader = tableHeaderMatch
    ? `<w:tbl>${tableHeaderMatch[1]}`
    : `<w:tbl>${tableXml.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/)?.[0] || ''}`;
  return `${tableHeader}${rebuiltRows.join('')}</w:tbl>`;
}

function setTcBorderSide(tcXml, side, val) {
  const nil = `<w:${side} w:val="${val}" w:sz="0" w:space="0" w:color="auto"/>`;
  if (tcXml.includes('<w:tcBorders>')) {
    const re = new RegExp(`<w:${side}\\b[^/]*/>`);
    if (re.test(tcXml)) return tcXml.replace(re, nil);
    return tcXml.replace('</w:tcBorders>', `${nil}</w:tcBorders>`);
  }
  const tcPrEnd = tcXml.indexOf('</w:tcPr>');
  if (tcPrEnd < 0) return tcXml;
  const borders = `<w:tcBorders>${nil}</w:tcBorders>`;
  return tcXml.slice(0, tcPrEnd) + borders + tcXml.slice(tcPrEnd);
}

function cellPlainText(tcXml) {
  return [...tcXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => m[1])
    .join('')
    .trim();
}

function fixActHeaderRecipientName(xml, recipientFull, recipientShort) {
  let out = xml;
  if (recipientFull) {
    const cellMarker = 'Директору';
    const idx = out.indexOf(cellMarker);
    if (idx >= 0) {
      const tblStart = out.lastIndexOf('<w:tbl>', idx);
      const tblEnd = out.indexOf('</w:tbl>', idx);
      if (tblStart >= 0 && tblEnd > idx) {
        const table = out.slice(tblStart, tblEnd + '</w:tbl>'.length);
        const cells = table.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
        let changed = false;
        const patched = cells.map((tc) => {
          const text = cellPlainText(tc);
          if (!/Директору|Начальнику|Инженеру|Специалисту|Руководителю|Ответственному/i.test(text)) {
            return tc;
          }
          if (!text.includes(cellMarker) && !/директору/i.test(text)) return tc;
          changed = true;
          return setCellPlainText(tc, recipientFull);
        });
        if (changed) {
          let ci = 0;
          const rebuilt = table.replace(/<w:tc>[\s\S]*?<\/w:tc>/g, () => patched[ci++]);
          out = out.slice(0, tblStart) + rebuilt + out.slice(tblEnd + '</w:tbl>'.length);
        }
      }
    }
  }
  return out;
}

function setCellPlainText(tcXml, text) {
  const tcPr = tcXml.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] || '';
  const escaped = xmlEscape(text);
  return `<w:tc>${tcPr}<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:sz w:val="${ACT_FONT_SZ}"/><w:szCs w:val="${ACT_FONT_SZ}"/></w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p></w:tc>`;
}

function fixActHeaderRecipientTable(xml) {
  const marker = 'Акт проверки';
  const idx = xml.indexOf(marker);
  if (idx < 0) return xml;
  const tblStart = xml.lastIndexOf('<w:tbl>', idx);
  const tblEnd = xml.indexOf('</w:tbl>', idx);
  if (tblStart < 0 || tblEnd < 0) return xml;

  let tableXml = xml.slice(tblStart, tblEnd + '</w:tbl>'.length);
  const rows = tableXml.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
  if (rows.length < 2) return xml;

  const rebuiltRows = rows.map((rowXml) => {
    const cells = rowXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
    const rebuiltCells = cells.map((tc) => {
      const text = cellPlainText(tc);
      let out = tc;
      if (text.includes('Акт проверки')) out = setTcBorderSide(out, 'bottom', 'nil');
      if (/Директору|Начальнику|Инженеру|Специалисту|Руководителю|Ответственному/i.test(text)) {
        out = setTcBorderSide(out, 'top', 'nil');
      }
      return out;
    });
    const trOpen = rowXml.match(/^<w:tr[^>]*>/)?.[0] || '<w:tr>';
    const trPr = rowXml.match(/<w:trPr>[\s\S]*?<\/w:trPr>/)?.[0] || '';
    return `${trOpen}${trPr}${rebuiltCells.join('')}</w:tr>`;
  });

  const tableHeaderMatch = tableXml.match(/^<w:tbl>([\s\S]*?)<w:tr>/);
  const tableHeader = tableHeaderMatch
    ? `<w:tbl>${tableHeaderMatch[1]}`
    : `<w:tbl>${tableXml.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/)?.[0] || ''}`;
  const fixedTable = `${tableHeader}${rebuiltRows.join('')}</w:tbl>`;
  return xml.slice(0, tblStart) + fixedTable + xml.slice(tblEnd + '</w:tbl>'.length);
}

function fixActSignatureTable(xml, specialist, actDate) {
  const marker = 'Акт проверки получил';
  const tableStart = xml.indexOf(marker);
  if (tableStart < 0) return xml;
  const tblStart = xml.lastIndexOf('<w:tbl>', tableStart);
  const tblEnd = xml.indexOf('</w:tbl>', tableStart);
  if (tblStart < 0 || tblEnd < 0) return xml;

  const table = rebuildSignatureTable(xml.slice(tblStart, tblEnd + '</w:tbl>'.length), specialist, actDate);
  return xml.slice(0, tblStart) + table + xml.slice(tblEnd + '</w:tbl>'.length);
}

function findParagraphStart(xml, beforeIndex) {
  const seg = xml.slice(0, beforeIndex);
  let pos = -1;
  let searchFrom = 0;
  while (searchFrom < seg.length) {
    const i = seg.indexOf('<w:p', searchFrom);
    if (i < 0) break;
    const next = seg[i + 4];
    if (next === ' ' || next === '>') pos = i;
    searchFrom = i + 4;
  }
  return pos;
}

function isEmptyParagraph(para) {
  const hasText = [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].some((m) => m[1].trim().length > 0);
  const hasDrawing = para.includes('<w:drawing>');
  const hasPageBreak =
    para.includes('w:br w:type="page"') || para.includes('w:pageBreakBefore w:val="1"');
  return !hasText && !hasDrawing && !hasPageBreak;
}

function stripTrailingEmptyParagraphs(xml) {
  const endTag = '</w:body>';
  const end = xml.lastIndexOf(endTag);
  if (end < 0) return xml;
  let content = xml.slice(0, end);
  const after = xml.slice(end + endTag.length);

  const sectIdx = content.lastIndexOf('<w:sectPr');
  let head = sectIdx >= 0 ? content.slice(0, sectIdx) : content;
  const tail = sectIdx >= 0 ? content.slice(sectIdx) : '';

  while (true) {
    const trimmed = head.replace(/\s+$/, '');
    const pEnd = trimmed.lastIndexOf('</w:p>');
    if (pEnd < 0) break;
    const pStart = findParagraphStart(trimmed, pEnd);
    if (pStart < 0) break;
    const para = trimmed.slice(pStart, pEnd + '</w:p>'.length);
    if (!isEmptyParagraph(para)) break;
    head = trimmed.slice(0, pStart);
  }

  return head + tail + endTag + after;
}

function compactActPageLayout(xml) {
  let out = String(xml || '');
  out = out.replace(
    /<w:pgMar\b[^>]*\/>/g,
    '<w:pgMar w:top="680" w:right="680" w:bottom="680" w:left="1020" w:header="340" w:footer="340" w:gutter="0"/>'
  );
  out = out.replace(/<w:spacing w:before="\d+"/g, '<w:spacing w:before="0"');
  out = out.replace(/<w:spacing w:after="\d+"/g, (m) => {
    const val = Number((m.match(/\d+/) || ['120'])[0]);
    return `<w:spacing w:after="${Math.min(val, 40)}"`;
  });
  out = out.replace(/<w:spacing w:line="\d+"/g, '<w:spacing w:line="240"');
  out = out.replace(/w:lineRule="auto"/g, 'w:lineRule="exact"');
  out = out.replace(PAGE_BREAK_PARA, '');
  out = out.replace(/<w:br w:type="page"\s*\/>/g, '');
  out = out.replace(/<w:pageBreakBefore w:val="1"\s*\/>/g, '');
  return out;
}

function normalizeActTypography(xml) {
  let out = String(xml || '');
  out = out.replace(/<w:highlight\b[^>]*\/>/g, '');
  out = out.replace(
    /<w:rFonts\b[^>]*\/>/g,
    `<w:rFonts w:ascii="${ACT_FONT}" w:hAnsi="${ACT_FONT}" w:cs="${ACT_FONT}" w:eastAsia="${ACT_FONT}"/>`
  );
  out = out.replace(/w:asciiTheme="[^"]*"/g, `w:ascii="${ACT_FONT}"`);
  out = out.replace(/w:hAnsiTheme="[^"]*"/g, `w:hAnsi="${ACT_FONT}"`);
  out = out.replace(/w:csTheme="[^"]*"/g, `w:cs="${ACT_FONT}"`);
  out = out.replace(/<w:sz w:val="\d+"\s*\/>/g, `<w:sz w:val="${ACT_FONT_SZ}"/>`);
  out = out.replace(/<w:szCs w:val="\d+"\s*\/>/g, `<w:szCs w:val="${ACT_FONT_SZ}"/>`);
  return out;
}

function normalizeStylesTypography(xml) {
  let out = String(xml || '');
  out = out.replace(
    /<w:rFonts\b[^>]*\/>/g,
    `<w:rFonts w:ascii="${ACT_FONT}" w:hAnsi="${ACT_FONT}" w:cs="${ACT_FONT}" w:eastAsia="${ACT_FONT}"/>`
  );
  out = out.replace(/w:asciiTheme="[^"]*"/g, '');
  out = out.replace(/w:hAnsiTheme="[^"]*"/g, '');
  out = out.replace(/w:csTheme="[^"]*"/g, '');
  out = out.replace(/w:eastAsiaTheme="[^"]*"/g, '');
  out = out.replace(/<w:sz w:val="\d+"\s*\/>/g, `<w:sz w:val="${ACT_FONT_SZ}"/>`);
  out = out.replace(/<w:szCs w:val="\d+"\s*\/>/g, `<w:szCs w:val="${ACT_FONT_SZ}"/>`);
  return out;
}

function normalizeThemeTypography(xml) {
  let out = String(xml || '');
  // Заменяем major/minor latin typeface на Times New Roman
  out = out.replace(/<a:latin[^>]*typeface="[^"]*"[^>]*\/>/g, `<a:latin typeface="${ACT_FONT}"/>`);
  out = out.replace(/<a:ea[^>]*typeface="[^"]*"[^>]*\/>/g, `<a:ea typeface="${ACT_FONT}"/>`);
  out = out.replace(/<a:cs[^>]*typeface="[^"]*"[^>]*\/>/g, `<a:cs typeface="${ACT_FONT}"/>`);
  return out;
}

function normalizeDocxPackageTypography(zip) {
  const tryPatch = (p, fn) => {
    try {
      const f = zip.file(p);
      if (!f) return;
      const txt = f.asText();
      zip.file(p, fn(txt));
    } catch (_) {}
  };
  tryPatch('word/styles.xml', normalizeStylesTypography);
  tryPatch('word/stylesWithEffects.xml', normalizeStylesTypography);
  tryPatch('word/theme/theme1.xml', normalizeThemeTypography);
  tryPatch('word/fontTable.xml', normalizeStylesTypography);
  // если есть header/footer — тоже нормализуем
  const files = zip.file(/word\/(header|footer)\d+\.xml/);
  (files || []).forEach((f) => {
    try {
      zip.file(f.name, normalizeActTypography(f.asText()));
    } catch (_) {}
  });
}

function applyActOverrides(violation, overrides) {
  const o = overrides && typeof overrides === 'object' ? overrides : null;
  if (!o) return violation;
  const v = { ...violation };
  if (typeof o.description === 'string') v.description = o.description.trim();
  if (typeof o.responsible === 'string') v.responsible = o.responsible.trim();
  if (typeof o.normRefsText === 'string') {
    const list = o.normRefsText
      .split(/[\n;,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    v.normRefs = list;
  }
  return v;
}

function fixPrescriptionIssuedBlock(xml, specialist, actDate) {
  const marker = 'Предписание выдал:';
  const jobTitle = specialist.jobTitle || DEFAULT_JOB_TITLE;
  const issuerName = specialist.initials || specialist.fio || '—';
  let out = xml;
  let searchFrom = 0;
  while (true) {
    const idx = out.indexOf(marker, searchFrom);
    if (idx < 0) break;
    const pStart = out.lastIndexOf('<w:p ', idx);
    if (pStart < 0) break;
    const recvIdx = out.indexOf('Предписание получил:', idx);
    const prIdx = out.indexOf('ПРЕДПИСАНИЕ', idx + marker.length);
    let p2End = -1;
    if (recvIdx > idx) p2End = out.lastIndexOf('<w:p ', recvIdx);
    else if (prIdx > idx) p2End = out.lastIndexOf('<w:p ', prIdx);
    else {
      const pEnd = out.indexOf('</w:p>', idx);
      p2End = pEnd >= 0 ? pEnd + '</w:p>'.length : -1;
    }
    if (p2End < 0) break;

    const block =
      '<w:p><w:pPr><w:jc w:val="left"/></w:pPr>' +
      `<w:r><w:rPr><w:sz w:val="${ACT_FONT_SZ}"/><w:szCs w:val="${ACT_FONT_SZ}"/></w:rPr><w:t xml:space="preserve">Предписание выдал:   </w:t></w:r>` +
      `<w:r><w:rPr><w:sz w:val="${ACT_FONT_SZ}"/><w:szCs w:val="${ACT_FONT_SZ}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(actDate)} г.            </w:t></w:r>` +
      `<w:r><w:rPr><w:sz w:val="${ACT_FONT_SZ}"/><w:szCs w:val="${ACT_FONT_SZ}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(issuerName)}</w:t></w:r>` +
      '</w:p>' +
      textPara(`${jobTitle} ${ISSUER_ORG_SHORT}`);

    out = out.slice(0, pStart) + block + out.slice(p2End);
    searchFrom = pStart + block.length;
  }
  return out;
}

function fixPrescriptionHeaderBlock(xml, orgShort, actDateWords, prescriptionNum) {
  const titleIdx = xml.indexOf('ПРЕДПИСАНИЕ', xml.indexOf('(инициалы, фамилия)') + 1);
  if (titleIdx < 0) return xml;
  const komuIdx = xml.indexOf('Кому', titleIdx);
  if (komuIdx < 0) return xml;
  const pStart = xml.lastIndexOf('<w:p ', titleIdx);
  const pKomuStart = xml.lastIndexOf('<w:p ', komuIdx);
  if (pStart < 0 || pKomuStart < 0) return xml;
  const block =
    textPara('ПРЕДПИСАНИЕ', { center: true, underline: true }) +
    textPara(orgShort, { center: true }) +
    textPara(`${actDateWords}                    №  ${prescriptionNum}`);
  return xml.slice(0, pStart) + block + xml.slice(pKomuStart);
}

function insertPageBreakBeforeParagraphMarker(xml, marker) {
  const idx = xml.indexOf(marker);
  if (idx < 0) return xml;
  const pStart = xml.lastIndexOf('<w:p ', idx);
  if (pStart < 0) return xml;
  return xml.slice(0, pStart) + PAGE_BREAK_PARA + xml.slice(pStart);
}

function removeDrawingWithEmbed(xml, rid) {
  const token = `r:embed="${rid}"`;
  let searchFrom = 0;
  let out = xml;
  while (true) {
    const idx = out.indexOf(token, searchFrom);
    if (idx < 0) break;
    const dStart = out.lastIndexOf('<w:drawing>', idx);
    const dEnd = out.indexOf('</w:drawing>', idx);
    if (dStart < 0 || dEnd < 0) break;
    out = out.slice(0, dStart) + out.slice(dEnd + '</w:drawing>'.length);
    searchFrom = dStart;
  }
  return out;
}

function maxRelId(relsXml) {
  const ids = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  return ids.length ? Math.max(...ids) : 0;
}

function addImageRelationship(relsXml, id, filename) {
  const rel =
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${filename}"/>`;
  return relsXml.replace('</Relationships>', rel + '</Relationships>');
}

function photoDrawingInner(relId, name, docPrId, cx, cy) {
  return `<w:drawing><wp:inline distB="0" distT="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent b="0" l="0" r="0" t="0"/><wp:docPr id="${docPrId}" name="${xmlEscape(name)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${xmlEscape(name)}"/><pic:cNvPicPr preferRelativeResize="0"/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"/><a:ln/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function photoParagraph(relId, name, docPrId, spacingAfter = 0) {
  const sp = spacingAfter ? `<w:spacing w:after="${spacingAfter}"/>` : '';
  return `<w:p><w:pPr><w:jc w:val="center"/>${sp}</w:pPr><w:r>${photoDrawingInner(relId, name, docPrId, PHOTO_PAIR_CX, PHOTO_PAIR_CY)}</w:r></w:p>`;
}

function buildPhotoPairPage(relId1, relId2, name1, name2, docPrId1, docPrId2) {
  let inner = photoParagraph(relId1, name1, docPrId1, relId2 ? PHOTO_GAP_AFTER : 0);
  if (relId2) inner += photoParagraph(relId2, name2, docPrId2);
  return inner;
}

function insertAfterMarker(xml, marker, insert) {
  const idx = xml.indexOf(marker);
  if (idx < 0) return xml.replace('</w:body>', insert + '</w:body>');
  const pEnd = xml.indexOf('</w:p>', idx);
  if (pEnd < 0) return xml.replace('</w:body>', insert + '</w:body>');
  return xml.slice(0, pEnd + '</w:p>'.length) + insert + xml.slice(pEnd + '</w:p>'.length);
}

function applyLayoutAndPhotos(zip, docXml, photos) {
  let xml = compactActPageLayout(docXml);
  xml = removeDrawingWithEmbed(xml, 'rId8');
  if (photos.length) {
    xml = insertPageBreakBeforeParagraphMarker(xml, 'Приложение №1 ');
  }

  if (!photos.length) {
    return xml;
  }

  let rels = zip.file('word/_rels/document.xml.rels').asText();
  let relId = maxRelId(rels);
  let docPrId = 100;
  let photoXml = '';

  for (let i = 0; i < photos.length; i += 2) {
    if (i > 0) photoXml += PAGE_BREAK_PARA;
    const p1 = photos[i];
    const p2 = photos[i + 1] || null;

    relId += 1;
    docPrId += 1;
    const rid1 = `rId${relId}`;
    const id1 = docPrId;
    const ext1 = (p1.mime || '').includes('png') ? '.png' : '.jpg';
    const fname1 = `violation_photo_${i + 1}${ext1}`;
    zip.file(`word/media/${fname1}`, p1.buffer);
    rels = addImageRelationship(rels, rid1, fname1);

    let rid2 = null;
    let id2 = id1;
    let fname2 = '';
    if (p2) {
      relId += 1;
      docPrId += 1;
      rid2 = `rId${relId}`;
      id2 = docPrId;
      const ext2 = (p2.mime || '').includes('png') ? '.png' : '.jpg';
      fname2 = `violation_photo_${i + 2}${ext2}`;
      zip.file(`word/media/${fname2}`, p2.buffer);
      rels = addImageRelationship(rels, rid2, fname2);
    }

    photoXml += buildPhotoPairPage(rid1, rid2, fname1, fname2, id1, id2);
  }

  zip.file('word/_rels/document.xml.rels', rels);
  const appendixMarker = 'Приложение №1 к акту проверки';
  if (xml.includes(appendixMarker)) {
    return insertAfterMarker(xml, appendixMarker, photoXml);
  }
  return insertAfterMarker(xml, 'промышленной и пожарной безопасности»', photoXml);
}

function generatePrescriptionDocx(violation, db, ctx) {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error('Шаблон акта-предписания не найден на сервере');
  }
  const v2 = applyActOverrides(violation, ctx?.actOverrides);
  const prescriptionNum = prescriptionNumber(v2, db);
  const fullCtx = { ...ctx, violation: v2, prescriptionNum, db };
  const authorUser = resolveActAuthorUser(ctx.user, v2, fullCtx);
  const createdByName = resolveActAuthorName(authorUser, v2, fullCtx);
  const jobTitle = resolveJobTitle(authorUser);
  const specialist = {
    ...formatSpecialistFromUser(authorUser, createdByName),
    jobTitle,
    jobTitleInst: jobTitleInstrumental(jobTitle),
  };
  const actDate = formatDateRu(v2.createdAt);
  fullCtx.createdByName = createdByName;
  const actDateWords = formatDateWordsRu(v2.createdAt);

  const dbRef = fullCtx.db || db;
  const contractor = (dbRef.contractors || []).find((c) => c.id === v2.contractorId);
  const recipientFull = recipientLine(contractor, v2, dbRef);

  const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH, 'binary'));
  normalizeDocxPackageTypography(zip);
  const docPath = 'word/document.xml';
  let docXml = zip.file(docPath).asText();
  const reportEmails = resolveReportEmails(fullCtx, v2);
  docXml = replaceAll(docXml, buildReplacements(fullCtx, specialist));
  docXml = scrubStaleReportMailboxes(docXml, reportEmails);
  docXml = replaceAuditorPlaceholders(docXml, specialist);
  docXml = fixActHeaderRecipientTable(docXml);
  docXml = fixActHeaderRecipientName(docXml, recipientFull);
  docXml = fixActSignatureTable(docXml, specialist, actDate);
  docXml = fixPrescriptionIssuedBlock(docXml, specialist, actDate);
  docXml = fixPrescriptionHeaderBlock(docXml, ISSUER_ORG_SHORT, actDateWords, prescriptionNum);

  const photos = loadPhotoBuffers(v2.media);
  docXml = applyLayoutAndPhotos(zip, docXml, photos);
  docXml = insertPageBreakBeforeParagraphMarker(docXml, 'ПРЕДПИСАНИЕ');
  docXml = normalizeActTypography(docXml);
  docXml = stripTrailingEmptyParagraphs(docXml);
  zip.file(docPath, docXml);

  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const safeNum = String(v2.number || prescriptionNum).replace(/[\\/:*?"<>|]/g, '_');
  const filename = `akt-predpisanie_${safeNum}.docx`;

  return {
    buffer,
    filename,
    prescriptionNum,
    photos,
  };
}

function buildEmailAttachments(violation, db, ctx) {
  const doc = generatePrescriptionDocx(violation, db, ctx);
  return {
    attachments: [
      {
        filename: doc.filename,
        content: doc.buffer,
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
    ],
    prescriptionNum: doc.prescriptionNum,
  };
}

module.exports = {
  generatePrescriptionDocx,
  buildEmailAttachments,
  prescriptionNumber,
  TEMPLATE_PATH,
  formatSpecialist,
  formatActPersonName,
  formatSpecialistFromUser,
  resolveActAuthorUser,
  specialistNameFromUser,
  resolveActAuthorName,
  resolveJobTitle,
  resolveReportEmails,
  jobTitleInstrumental,
  DEFAULT_JOB_TITLE,
};
