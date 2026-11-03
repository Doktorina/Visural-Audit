const DEFAULT_CATEGORIES = [
  { id: 'ppe', name: 'СИЗ', icon: 'ic-goggles', sortOrder: 1 },
  { id: 'electro', name: 'Электробезопасность', icon: 'ic-bolt', sortOrder: 2 },
  { id: 'height', name: 'Работа на высоте', icon: 'ic-ladder', sortOrder: 3 },
  { id: 'fire', name: 'Пожарная безопасность', icon: 'ic-flame', sortOrder: 4 },
  { id: 'culture', name: 'Культура безопасности', icon: 'ic-culture', sortOrder: 5 },
  { id: 'load', name: 'Грузы / складирование', icon: 'ic-load', sortOrder: 6 },
  { id: 'doc', name: 'Документы', icon: 'ic-doc', sortOrder: 7 },
  { id: 'machinery', name: 'Машины / механизмы', icon: 'ic-crane', sortOrder: 8 },
  { id: 'other', name: 'Прочие нарушения', icon: 'ic-other', sortOrder: 99 },
];

const CYR_TO_LAT = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
};

function translitRu(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => CYR_TO_LAT[ch] || ch)
    .join('');
}

function slugifyId(name) {
  const base = translitRu(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return base || `cat-${Date.now().toString(36)}`;
}

function normalizeCategory(raw, index = 0) {
  const name = String(raw?.name || '').trim();
  if (!name) return null;
  const id = String(raw?.id || slugifyId(name)).trim() || slugifyId(name);
  const rawOrder = Number(raw?.sortOrder);
  const normalizedOrder = Number.isFinite(rawOrder) ? rawOrder : index + 1;
  return {
    id,
    name,
    icon: String(raw?.icon || '📋').trim() || '📋',
    sortOrder: id === 'other' ? 99 : normalizedOrder,
  };
}

function getCategories(db) {
  const list = Array.isArray(db?.categories) ? db.categories : [];
  const normalized = list.map((c, i) => normalizeCategory(c, i)).filter(Boolean);
  if (normalized.length) {
    return [...normalized].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }
  return DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

function ensureCategories(db) {
  const hasList = Array.isArray(db?.categories) && db.categories.length;
  if (!hasList) {
    db.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  } else {
    const ids = new Set(db.categories.map((c) => String(c.id || '').trim()));
    const isLegacyPreset =
      ids.has('hazard') || ids.has('gas') || ids.has('noise') || ids.has('permit') || ids.has('ground') || ids.has('scaffold');
    if (isLegacyPreset && !ids.has('culture') && !ids.has('doc')) {
      db.categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
    }
    db.categories = db.categories.map((c, i) => {
      const n = normalizeCategory(c, i);
      if (!n) return c;
      return n;
    });
  }
  return getCategories(db);
}

function categoryLabel(violation, categories) {
  const list = categories || DEFAULT_CATEGORIES;
  if (violation?.categoryId === 'other' && violation?.categoryOther) {
    return String(violation.categoryOther).trim();
  }
  const cat = list.find((c) => c.id === violation?.categoryId);
  return cat?.name || 'Другое';
}

module.exports = {
  DEFAULT_CATEGORIES,
  slugifyId,
  normalizeCategory,
  getCategories,
  ensureCategories,
  categoryLabel,
};
