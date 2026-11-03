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
  number: 'TEST/P',
  description: 'Тест',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [b64, b64],
  normRefs: ['ПОТ'],
};
const xml = new PizZip(
  pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] }).buffer
).file('word/document.xml').asText();
const bodyEnd = xml.lastIndexOf('</w:body>');
const tail = xml.slice(bodyEnd - 4000, bodyEnd + 20);
const paras = [...tail.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)].map((m, i) => {
  const t = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('');
  const hasPB = m[0].includes('w:br w:type="page"');
  const hasSect = m[0].includes('w:sectPr');
  const hasImg = m[0].includes('w:drawing>');
  return { i, t: t.slice(0, 40), hasPB, hasSect, hasImg, len: m[0].length };
});
console.log('last paras:', paras.slice(-12));
console.log('total page breaks', (xml.match(/w:br w:type="page"/g) || []).length);
