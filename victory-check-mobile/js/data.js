const STORAGE_KEY = 'victory_check_data';
const DEFAULT_NOTIFY_EMAIL = '';
const BLOCKED_NOTIFY_EMAILS = new Set(['kirillsadrin983@gmail.com']);

function filterNotifyRecipients(list) {
  const out = new Set();
  (list || []).forEach((e) => {
    const addr = String(e || '').trim().toLowerCase();
    if (!addr.includes('@') || BLOCKED_NOTIFY_EMAILS.has(addr)) return;
    out.add(addr);
  });
  return [...out];
}

let CATEGORIES = [
  { id: 'ppe', name: 'СИЗ', icon: 'ic-goggles' },
  { id: 'electro', name: 'Электробезопасность', icon: 'ic-bolt' },
  { id: 'height', name: 'Работа на высоте', icon: 'ic-ladder' },
  { id: 'fire', name: 'Пожарная безопасность', icon: 'ic-flame' },
  { id: 'culture', name: 'Культура безопасности', icon: 'ic-culture' },
  { id: 'load', name: 'Грузы / складирование', icon: 'ic-load' },
  { id: 'doc', name: 'Документы', icon: 'ic-doc' },
  { id: 'machinery', name: 'Машины / механизмы', icon: 'ic-crane' },
  { id: 'other', name: 'Прочие нарушения', icon: 'ic-other' },
];

function setCategories(list) {
  if (!Array.isArray(list) || !list.length) return;
  CATEGORIES = list.map((c) => ({
    id: c.id,
    name: c.name,
    icon: c.icon || '📋',
  }));
}

async function loadCategoriesFromApi() {
  if (!window.VictoryAPI?.getCategories) return CATEGORIES;
  try {
    const data = await VictoryAPI.getCategories();
    setCategories(data.categories);
  } catch (_) {}
  return CATEGORIES;
}

const SEVERITY = [
  { id: 'major', label: 'Грубые (высокий риск)', hint: 'Устранение в течение 24 часов', hours: 24 },
  { id: 'minor', label: 'Значительные (средний риск)', hint: 'Устранение в течение 3 дней', hours: 72 },
  {
    id: 'recommendation',
    label: 'Формальные (низкий риск)',
    hint: 'Устранение в течение 7 дней',
    hours: 168,
  },
];

/** До срока осталось не более 2 суток (срок ещё не прошёл) */
const CRITICAL_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;

function isDeadlineCritical(v, now = new Date()) {
  if (!v?.deadline) return false;
  if (v.status === 'resolved' || v.status === 'verification') return false;
  const msLeft = new Date(v.deadline) - now;
  if (msLeft < 0) return false;
  return msLeft <= CRITICAL_BEFORE_MS;
}

const STATUS_LABELS = {
  new: 'Открыто',
  in_progress: 'В работе',
  verification: 'На проверке',
  resolved: 'Устранено',
  overdue: 'Просрочено',
};

const DEMO_OBJECTS = [
  { id: '1', name: 'ЖК «Северный», корпус 3', code: 'SEV-3' },
  { id: '2', name: 'ТРЦ «Галерея»', code: 'GAL' },
  { id: '3', name: 'Складской комплекс', code: 'SKL' },
];

const DEMO_CONTRACTORS = [
  {
    id: '1',
    name: 'ООО «Строймонтаж»',
    type: 'ooo',
    inn: '7701234567',
    executor: 'Иванов И.И.',
    email: 'stroy@example.ru',
  },
  {
    id: '2',
    name: 'ИП Петров',
    type: 'ip',
    inn: '7709876543',
    executor: 'Петров П.П.',
    email: 'petrov@example.ru',
  },
  {
    id: '3',
    name: 'АО «СпецСтрой»',
    type: 'ooo',
    inn: '7705551212',
    executor: 'Сидоров С.С.',
    email: 'spec@example.ru',
  },
];

const DIRS_KEY = 'vc_directories';

function loadLocalDirectories(opts = {}) {
  const useDemo = opts.useDemo === true;
  try {
    const raw = localStorage.getItem(DIRS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.objects)) {
        return {
          objects: parsed.objects,
          contractors: Array.isArray(parsed.contractors) ? parsed.contractors : [],
          syncedAt: parsed.syncedAt || null,
        };
      }
    }
  } catch (_) {}
  if (useDemo) {
    return {
      objects: DEMO_OBJECTS.map((o) => ({ ...o })),
      contractors: DEMO_CONTRACTORS.map((c) => ({ ...c })),
      syncedAt: null,
    };
  }
  return { objects: [], contractors: [], syncedAt: null };
}

function hydrateRefsFromCache() {
  const d = loadLocalDirectories();
  if (d.objects?.length) setRefs(d.objects, d.contractors || []);
}

function saveLocalDirectories(data) {
  localStorage.setItem(DIRS_KEY, JSON.stringify(data));
}

function loadStore() {
  const defaults = {
    user: null,
    violations: [],
    seq: {},
    notifications: [],
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        violations: Array.isArray(parsed.violations) ? parsed.violations : [],
        notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
        seq: parsed.seq || {},
      };
    }
  } catch (_) {}
  return defaults;
}

function ensureStoreArrays(store) {
  if (!Array.isArray(store.violations)) store.violations = [];
  if (!Array.isArray(store.notifications)) store.notifications = [];
  return store;
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function saveStoreSafe(store) {
  const trySave = (data) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  try {
    trySave(store);
    return true;
  } catch (e) {
    const trimmed = { ...store };
    if (Array.isArray(trimmed.violations)) {
      trimmed.violations = trimmed.violations.slice(0, 40).map((v) => ({
        ...v,
        media: Array.isArray(v.media) ? v.media.slice(0, 5) : [],
      }));
    }
    try {
      trySave(trimmed);
      return true;
    } catch (_) {
      trimmed.violations = (trimmed.violations || []).map((v) => {
        const { media, ...rest } = v;
        return { ...rest, media: [] };
      });
      try {
        trySave(trimmed);
        return false;
      } catch (err) {
        throw err;
      }
    }
  }
}

let REF_OBJECTS = [];
let REF_CONTRACTORS = [];

hydrateRefsFromCache();

function setRefs(objects, contractors) {
  if (objects?.length) REF_OBJECTS = objects;
  if (contractors?.length) REF_CONTRACTORS = contractors;
}

function getObject(id) {
  return REF_OBJECTS.find((o) => o.id === id);
}

function getContractor(id) {
  return REF_CONTRACTORS.find((c) => c.id === id);
}

function getCategory(id, violation) {
  if (id === 'other' && violation?.categoryOther) {
    return { id: 'other', name: String(violation.categoryOther).trim(), icon: '📋' };
  }
  return CATEGORIES.find((c) => c.id === id) || { id: id || 'other', name: 'Другое', icon: '📋' };
}

function calcDeadline(severityId, fromDate = new Date()) {
  const sev = SEVERITY.find((s) => s.id === severityId) || SEVERITY[0];
  const d = new Date(fromDate);
  d.setHours(d.getHours() + (sev.hours || 24));
  return d;
}

function nextViolationNumber(objectCode) {
  const store = loadStore();
  const year = new Date().getFullYear();
  const key = objectCode || 'OBJ';
  store.seq[key] = (store.seq[key] || 0) + 1;
  const num = String(store.seq[key]).padStart(5, '0');
  saveStore(store);
  return `${key}/${year}/${num}`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isOverdue(v) {
  if (v.status === 'resolved' || v.status === 'verification') return false;
  return new Date(v.deadline) < new Date();
}

