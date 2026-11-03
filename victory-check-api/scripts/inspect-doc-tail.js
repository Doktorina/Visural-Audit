const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const imgPath =
  'C:/Users/operator/.cursor/projects/c-Users-operator-Desktop-WOK/assets/c__Users_operator_AppData_Roaming_Cursor_User_workspaceStorage_d32f8f8d4e9e99ce0947bd3f4c9e0c25_images_image-0db9b3a3-9e2a-41ff-80f7-c4a625b5dc89.png';
const buf = fs.readFileSync(imgPath);
const b64 = 'data:image/png;base64,' + buf.toString('base64');
const v = {
  ...db.violations[0],
  number: 'TEST/PAGES',
  description: 'Тест',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [b64, b64],
  normRefs: ['ПОТ'],
};
const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] });
const xml = new PizZip(r.buffer).file('word/document.xml').asText();
const bodyEnd = xml.lastIndexOf('</w:body>');
const tail = xml.slice(bodyEnd - 6000, bodyEnd);
const texts = [...tail.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
console.log('tail texts:', texts.slice(-20));
console.log('pageBreaks', (xml.match(/w:br w:type="page"/g) || []).length);
console.log('pageBreakBefore at end', tail.includes('w:pageBreakBefore w:val="1"'));
// find empty paragraphs with page break at end
const pbParas = [...tail.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)].map((m) => m[0]);
const last5 = pbParas.slice(-8);
last5.forEach((p, i) => {
  const t = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  const hasPB = p.includes('w:br w:type="page"') || p.includes('w:pageBreakBefore w:val="1"');
  console.log(`para -${last5.length - i}: text="${t}" pageBreak=${hasPB} len=${p.length}`);
});
