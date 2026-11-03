const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...db.violations[0],
  number: 'TEST/SIG2',
  description: 'Тест',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [],
  normRefs: ['ПОТ'],
};
const xml = new PizZip(
  pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] }).buffer
).file('word/document.xml').asText();
const end = xml.indexOf('ПРЕДПИСАНИЕ');
const section = xml.slice(0, end);
const start = section.lastIndexOf('Предписание выдал');
console.log('act sig at', start, 'end', end);
const seg = xml.slice(start, end);
console.log('has table', seg.includes('<w:tbl>'));
console.log('rows', (seg.match(/<w:tr>/g) || []).length);
const texts = [...seg.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
console.log(texts.join(' | '));
