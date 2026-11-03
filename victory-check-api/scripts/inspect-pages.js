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
  media: [b64, b64, b64],
  normRefs: ['ст. 3, 6 «Правил по охране труда при работе на высоте»'],
};
const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] });
const xml = new PizZip(r.buffer).file('word/document.xml').asText();
const pageBreaks = (xml.match(/w:br w:type="page"/g) || []).length;
console.log('page breaks', pageBreaks);
const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
const j = texts.join('|');
console.log('tail:', j.slice(-300));
// last 3000 chars of body
const bodyEnd = xml.lastIndexOf('</w:body>');
console.log('body tail xml length', xml.slice(bodyEnd - 2500, bodyEnd).length);
const tailPlain = xml
  .slice(bodyEnd - 4000, bodyEnd)
  .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, t) => t)
  .replace(/<[^>]+>/g, '|');
console.log('body tail plain:', tailPlain.slice(-500));
