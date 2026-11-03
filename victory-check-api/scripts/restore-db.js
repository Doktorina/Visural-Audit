/**
 * Убрать демо-данные из db.json и восстановить рабочую копию.
 * node scripts/restore-db.js [--from-pg] [--out path]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'db.json');
const OUT_PATH = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : DB_PATH;

const DEMO_OBJECT_CODES = new Set(['SEV-3', 'GAL', 'SKL']);
const DEMO_OBJECT_NAMES = new Set([
  'ЖК «Северный», корпус 3',
  'ТРЦ «Галерея»',
  'Складской комплекс',
]);
const DEMO_CONTRACTOR_EMAILS = /@example\.ru$/i;
const DEMO_VIOLATION_IDS = new Set(['v1', 'v2', 'v3', 'v4']);
const DEMO_CONTRACTOR_NAMES = new Set(['ООО «Строймонтаж»', 'АО «СпецСтрой»']);

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line) => {
      const t = line.trim();
      if (!t || t.startsWith('#')) return;
      const i = t.indexOf('=');
      if (i > 0) process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    });
}

function isRealViolation(v) {
  if (!v || !v.id) return false;
  if (DEMO_VIOLATION_IDS.has(v.id)) return false;
  if (String(v.id).match(/^v\d{10,}/)) return true;
  if (Array.isArray(v.media) && v.media.some((m) => String(m).includes('/api/media/'))) return true;
  return !DEMO_VIOLATION_IDS.has(v.id);
}

function stripDemo(db) {
  const violations = (db.violations || []).filter(isRealViolation);
  const usedObjectIds = new Set(violations.map((v) => v.objectId).filter(Boolean));
  const usedContractorIds = new Set(violations.map((v) => v.contractorId).filter(Boolean));

  const objects = (db.objects || []).filter((o) => {
    if (usedObjectIds.has(o.id)) return true;
    if (DEMO_OBJECT_CODES.has(o.code) || DEMO_OBJECT_NAMES.has(o.name)) return false;
    return true;
  });

  const contractors = (db.contractors || []).filter((c) => {
    if (usedContractorIds.has(c.id)) return true;
    if (DEMO_CONTRACTOR_EMAILS.test(c.email || '')) return false;
    if (DEMO_CONTRACTOR_NAMES.has(c.name)) return false;
    return true;
  });

  const objectIds = new Set(objects.map((o) => o.id));
  const contractorIds = new Set(contractors.map((c) => c.id));
  const cleanViolations = violations.filter(
    (v) => objectIds.has(v.objectId) && contractorIds.has(v.contractorId)
  );

  const violIds = new Set(cleanViolations.map((v) => v.id));
  const notifications = (db.notifications || []).filter((n) => {
    if (!n.violationId) return true;
    return violIds.has(n.violationId);
  });

  return {
    ...db,
    objects,
    contractors,
    violations: cleanViolations,
    notifications,
  };
}

async function loadFromPg() {
  loadEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL не задан');
  const dataStore = require('../data-store');
  const usersStore = require('../users-store');
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query('SELECT 1');
    dataStore.attachPool(pool);
    const db = await dataStore.readDb();
    await usersStore.init();
    db.users = await usersStore.listUsers();
    return db;
  } finally {
    await pool.end();
  }
}

function loadFromJson(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const fromPg = process.argv.includes('--from-pg');
  let db;
  if (fromPg) {
    console.log('Экспорт из PostgreSQL…');
    db = await loadFromPg();
  } else {
    const src = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : DB_PATH;
    console.log('Источник:', src);
    db = loadFromJson(src);
  }

  const before = {
    objects: (db.objects || []).length,
    contractors: (db.contractors || []).length,
    violations: (db.violations || []).length,
    users: (db.users || []).length,
  };

  const cleaned = stripDemo(db);
  const after = {
    objects: cleaned.objects.length,
    contractors: cleaned.contractors.length,
    violations: cleaned.violations.length,
    users: (cleaned.users || []).length,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(cleaned, null, 2), 'utf8');

  console.log('До:', before);
  console.log('После (без демо):', after);
  console.log('Объекты:');
  cleaned.objects.forEach((o) => console.log(' -', o.code, o.name));
  console.log('Сохранено:', OUT_PATH);
}

main().catch((e) => {
  console.error('Ошибка:', e.message || e);
  process.exit(1);
});
