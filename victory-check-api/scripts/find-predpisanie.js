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
let pos = 0;
let i = 0;
while ((pos = xml.indexOf('Предписание', pos)) >= 0) {
  i++;
  const t = [...xml.slice(pos, pos + 80).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  console.log(i, pos, t || xml.slice(pos, pos + 40));
  pos++;
}
console.log('Акт проверки получил', xml.indexOf('Акт проверки получил'));
console.log('ПРЕДПИСАНИЕ', xml.indexOf('ПРЕДПИСАНИЕ'));
