const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...db.violations[0],
  number: 'GAL/2026/00114',
  description: 'енгшщшдлорпа',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [],
  normRefs: ['ц456787', '3542'],
  responsible: 'Kirull Shadrin',
};
const xml = new PizZip(
  pd.generatePrescriptionDocx(v, db, { object: db.objects[1], contractor: db.contractors[1] }).buffer
).file('word/document.xml').asText();
const marker = 'Специалист службы охраны труда';
const tableStart = xml.indexOf(marker);
const tblStart = xml.lastIndexOf('<w:tbl>', tableStart);
const tblEnd = xml.indexOf('</w:tbl>', tableStart) + '</w:tbl>'.length;
const table = xml.slice(tblStart, tblEnd);
console.log('has tblGrid', table.includes('<w:tblGrid>'));
console.log('gridCol', (table.match(/<w:gridCol /g) || []).length);
const rows = table.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
console.log('rows', rows.length);
rows.forEach((r, i) => {
  const cells = r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
  const texts = [...r.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|');
  console.log(`row ${i}: ${cells.length} cells -> ${texts}`);
});
