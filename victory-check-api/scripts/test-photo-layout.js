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
  number: 'TEST/PHOTO2',
  description: 'Тест',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [b64, b64],
  normRefs: ['ст. 3, 6 «Правил по охране труда при работе на высоте»'],
};
const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] });
const xml = new PizZip(r.buffer).file('word/document.xml').asText();
const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
const j = texts.join('|');
const idx = j.indexOf('Приложение №1 к акту');
console.log('appendix area:', j.slice(idx, idx + 200));
const fi = j.lastIndexOf('фото');
console.log('last фото:', j.slice(Math.max(0, fi - 60), fi + 60));
console.log('shelves:', (xml.match(/______________________________________________/g) || []).length);
// check double underline: shelf para with w:u
const shelfIdx = xml.indexOf('______________________________________________');
if (shelfIdx > 0) {
  const seg = xml.slice(shelfIdx - 200, shelfIdx + 50);
  console.log('shelf has underline attr:', seg.includes('w:u w:val="single"'));
}
fs.writeFileSync(path.join(__dirname, '..', 'data', 'outbox', 'test-photo-layout.docx'), r.buffer);
console.log('written test-photo-layout.docx');
console.log('[фото] removed:', !xml.includes('[фото]'));
console.log('photo files', Object.keys(new PizZip(r.buffer).files).filter((k) => k.includes('violation_photo_')));
console.log('photo spacing:', xml.includes('w:spacing w:after="480"'));
const ni = xml.indexOf('В соответствии с требованиями');
if (ni > 0) {
  const runs = [...xml.slice(ni, ni + 2500).matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
  console.log('norm block:', runs.slice(0, 4).join(''));
}
