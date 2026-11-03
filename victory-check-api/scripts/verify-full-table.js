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
const marker = 'Специалист службы охраны труда';
const tableStart = xml.indexOf(marker);
const tblStart = xml.lastIndexOf('<w:tbl>', tableStart);
const tblEnd = xml.indexOf('</w:tbl>', tableStart) + '</w:tbl>'.length;
const seg = xml.slice(tblStart, tblEnd);
const simplified = seg
  .replace(/<w:tr>/g, '\n[TR]')
  .replace(/<\/w:tr>/g, '[/TR]')
  .replace(/<w:tc>/g, '[TC]')
  .replace(/<\/w:tc>/g, '[/TC]')
  .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '{$1}')
  .replace(/<[^>]+>/g, '');
console.log(simplified);
