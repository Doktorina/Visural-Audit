const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...db.violations[0],
  number: 'GAL/2026/00114',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [],
};
const xml = new PizZip(
  pd.generatePrescriptionDocx(v, db, { object: db.objects[1], contractor: db.contractors[1] }).buffer
).file('word/document.xml').asText();
const marker = 'Специалист службы охраны труда';
const tblStart = xml.lastIndexOf('<w:tbl>', xml.indexOf(marker));
const tblEnd = xml.indexOf('</w:tbl>', xml.indexOf(marker)) + '</w:tbl>'.length;
const table = xml.slice(tblStart, tblEnd);
const rows = table.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
console.log('rows', rows.length, 'gridSpan shelves', (table.match(/gridSpan w:val="4"/g) || []).length);
rows.forEach((r, i) => {
  const span4 = r.includes('gridSpan w:val="4"');
  const texts = [...r.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' | ');
  console.log(`row ${i}${span4 ? ' [MERGED SHELF]' : ''}: ${texts}`);
});
console.log('balanced p', (xml.match(/<w:p[\s>]/g) || []).length, (xml.match(/<\/w:p>/g) || []).length);
