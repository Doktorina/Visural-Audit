const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...(db.violations[0] || {}),
  number: 'TEST/SIG',
  description: 'Тест',
  createdAt: new Date().toISOString(),
  createdByName: 'Victory Admin',
  media: [],
  normRefs: ['ПОТ'],
};
const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] });
const xml = new PizZip(r.buffer).file('word/document.xml').asText();
const plain = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|');
console.log('has Victory Admin', plain.includes('Victory Admin'));
console.log('has V. Admin', plain.includes('V. Admin'));
console.log('has Chudinova', /Чудинова/i.test(plain));
console.log('prescription block', plain.includes('Предписание выдал:|Victory Admin'));
