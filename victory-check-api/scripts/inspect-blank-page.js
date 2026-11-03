const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const imgPath =
  'C:/Users/operator/.cursor/projects/c-Users-operator-Desktop-WOK/assets/c__Users_operator_AppData_Roaming_Cursor_User_workspaceStorage_d32f8f8d4e9e99ce0947bd3f4c9e0c25_images_image-0db9b3a3-9e2a-41ff-80f7-c4a625b5dc89.png';
const buf = fs.readFileSync(imgPath);
const b64 = 'data:image/png;base64,' + buf.toString('base64');

function gen(n) {
  const media = Array.from({ length: n }, () => b64);
  const v = {
    ...db.violations[0],
    number: `TEST/P${n}`,
    description: 'Тест',
    createdAt: '2026-06-15T10:00:00.000Z',
    createdByName: 'Е.О. Чудинова',
    media,
    normRefs: ['ПОТ'],
  };
  return new PizZip(
    pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] }).buffer
  ).file('word/document.xml').asText();
}

for (const n of [0, 1, 2, 3, 4]) {
  const xml = gen(n);
  const pb = (xml.match(/w:br w:type="page"/g) || []).length;
  const pbBefore = (xml.match(/w:pageBreakBefore w:val="1"/g) || []).length;
  const bodyEnd = xml.lastIndexOf('</w:body>');
  const tail = xml.slice(bodyEnd - 3000, bodyEnd);
  const emptyParas = [...tail.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)].filter((m) => {
    const t = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('');
    const hasImg = m[0].includes('<w:drawing>');
    const hasPB = m[0].includes('w:br w:type="page"');
    return !t && !hasImg;
  }).length;
  console.log(`photos=${n} pageBr=${pb} pbBefore=${pbBefore} emptyTailParas=${emptyParas}`);
}

// template tail after [фото]
const tpl = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const fi = tpl.indexOf('[фото]');
console.log('\ntemplate after [фото]:');
const seg = tpl.slice(fi - 200, fi + 1500);
const paras = [...seg.matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)].map((m) => {
  const t = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((x) => x[1]).join('');
  const hasPB = m[0].includes('w:br w:type="page"') || m[0].includes('w:pageBreakBefore w:val="1"');
  return { t, hasPB, len: m[0].length };
});
paras.forEach((p, i) => console.log(i, JSON.stringify(p)));
