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
  number: 'TEST/SIG2',
  description: 'Тест',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [b64, b64],
  normRefs: ['ПОТ'],
};
const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] });
const xml = new PizZip(r.buffer).file('word/document.xml').asText();
const start = xml.indexOf('Предписание выдал');
const end = xml.indexOf('ПРЕДПИСАНИЕ', start);
const seg = xml.slice(start, end);
const simplified = seg
  .replace(/<w:tr>/g, '\n[TR]')
  .replace(/<\/w:tr>/g, '[/TR]\n')
  .replace(/<w:tc>/g, '[TC]')
  .replace(/<\/w:tc>/g, '[/TC]')
  .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '{$1}')
  .replace(/<[^>]+>/g, '');
console.log(simplified.slice(0, 1200));
const bodyEnd = xml.lastIndexOf('</w:body>');
const tail = xml.slice(bodyEnd - 2000, bodyEnd);
const emptyTail = [...tail.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)].filter((m) => {
  const t = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('');
  return !t.trim();
}).length;
console.log('\nempty tail paras:', emptyTail);
console.log('extra shelf paras outside table:', (xml.match(/______________________________________________/g) || []).length);
