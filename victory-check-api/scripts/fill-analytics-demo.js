const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const MARK = '[analytics-demo]';

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

function pick(arr, i) {
  return arr[i % arr.length];
}

function isoDaysAgo(days, hour = 10) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, (days * 7) % 60, 0, 0);
  return d.toISOString();
}

function addDemoViolations(db, count = 24) {
  db.violations = Array.isArray(db.violations) ? db.violations : [];
  const exists = db.violations.filter((v) => String(v.description || '').includes(MARK)).length;
  if (exists >= count) return { added: 0, totalDemo: exists };

  const objects = (db.objects || []).map((o) => o.id);
  const contractors = (db.contractors || []).map((c) => c.id);
  const users = (db.users || []).map((u) => ({ id: u.id, name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email }));
  const categories = ['ppe', 'fire', 'electro', 'works', 'general'];
  const severities = ['minor', 'major', 'critical'];
  const statuses = ['open', 'in_progress', 'overdue', 'resolved', 'verification'];

  let seq = 1;
  for (let i = 0; i < count; i++) {
    const createdAt = isoDaysAgo(2 + i * 2, 9 + (i % 8));
    const deadline = isoDaysAgo(Math.max(0, 1 + i * 2 - (i % 3 === 0 ? 5 : -3)), 18);
    const objectId = pick(objects, i) || '1';
    const contractorId = pick(contractors, i + 1) || '1';
    const user = pick(users, i) || { id: 'u1', name: 'Аудитор Демо' };
    const status = pick(statuses, i);
    const severity = pick(severities, i);
    const categoryId = pick(categories, i);
    const objCode = (db.objects || []).find((o) => o.id === objectId)?.code || 'OBJ';
    const n = String((db.seq?.[objCode] || 200) + seq).padStart(5, '0');
    const number = `${objCode}/2026/${n}`;

    db.violations.push({
      id: `v_demo_analytics_${i + 1}`,
      number,
      objectId,
      contractorId,
      categoryId,
      severity,
      description: `${MARK} Демонстрационная запись №${i + 1} для аналитики`,
      status,
      deadline,
      createdAt,
      responsible: 'Ответственный по участку',
      createdByUserId: user.id,
      createdByName: user.name,
      media: [],
      history: [{ at: createdAt, text: 'Нарушение создано', by: 'Система' }],
      comments: [],
      normRefs: ['ПОТ', 'СНиП'],
      locationGps: null,
    });
    seq += 1;
  }

  return { added: count, totalDemo: exists + count };
}

function main() {
  const db = readDb();
  const { added, totalDemo } = addDemoViolations(db, 24);
  if (added > 0) writeDb(db);
  console.log(`analytics-demo: added=${added}, total_demo=${totalDemo}, total_violations=${(db.violations || []).length}`);
}

main();

