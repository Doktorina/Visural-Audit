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
const actRecv = xml.indexOf('Акт проверки получил');
const end = xml.indexOf('ПРЕДПИСАНИЕ');
const block1 = xml.slice(0, actRecv);
const block2 = xml.slice(actRecv, end);
function dump(label, seg) {
  const simplified = seg
    .replace(/<w:tr>/g, '\n[TR]')
    .replace(/<\/w:tr>/g, '[/TR]')
    .replace(/<w:tc>/g, '[TC]')
    .replace(/<\/w:tc>/g, '[/TC]')
    .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '{$1}')
    .replace(/<[^>]+>/g, '');
  console.log('\n===', label, '===');
  console.log(simplified.slice(-800));
}
dump('block1 tail', block1.slice(-3000));
dump('block2', block2.slice(0, 2500));
