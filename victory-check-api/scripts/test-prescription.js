#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const pd = require('../prescription-doc');

const dbPath = path.join(__dirname, '..', 'data', 'db.json');
const db = fs.existsSync(dbPath) ? JSON.parse(fs.readFileSync(dbPath, 'utf8')) : { violations: [], objects: [], contractors: [] };
const v = db.violations[0] || {
  number: 'TEST/001',
  description: 'Тест',
  createdAt: new Date().toISOString(),
  media: [],
  normRefs: ['ПОТ'],
  objectId: db.objects[0]?.id || '1',
  contractorId: db.contractors[0]?.id || '1',
};
const ctx = {
  object: db.objects[0] || { name: 'Тест', address: 'ул. Тест' },
  contractor: db.contractors[0] || { name: 'ООО Тест', executor: 'Иванов' },
};
try {
  console.log('template exists:', fs.existsSync(pd.TEMPLATE_PATH), pd.TEMPLATE_PATH);
  const r = pd.generatePrescriptionDocx(v, db, ctx);
  console.log('OK', r.filename, r.buffer.length, 'bytes');
  process.exit(0);
} catch (e) {
  console.error('FAIL', e.message || e);
  process.exit(1);
}
