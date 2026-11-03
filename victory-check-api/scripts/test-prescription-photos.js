const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');

const tpl = new PizZip(fs.readFileSync(pd.TEMPLATE_PATH, 'binary'));
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const uploads = path.join(__dirname, '..', 'data', 'uploads');
let media = [];
if (fs.existsSync(uploads)) {
  for (const dir of fs.readdirSync(uploads)) {
    const full = path.join(uploads, dir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const f of fs.readdirSync(full)) {
      media.push(`/api/media/${dir}/${f}`);
      if (media.length >= 3) break;
    }
    if (media.length >= 3) break;
  }
}
const v = {
  ...(db.violations[0] || {}),
  number: 'TEST/PHOTO',
  description: 'Тест фото',
  createdAt: new Date().toISOString(),
  media,
  normRefs: ['ПОТ'],
};
const ctx = { object: db.objects[0], contractor: db.contractors[0] };
const r = pd.generatePrescriptionDocx(v, db, ctx);
const out = new PizZip(r.buffer);
const logoTpl = tpl.file('word/media/image1.jpg')?.asNodeBuffer()?.length;
const logoOut = out.file('word/media/image1.jpg')?.asNodeBuffer()?.length;
const xml = out.file('word/document.xml').asText();
const photoFiles = Object.keys(out.files).filter((k) => k.includes('violation_photo_'));
console.log('logo preserved', logoTpl === logoOut, logoTpl, logoOut);
console.log('photo files in doc', photoFiles);
console.log('rId7 in doc', xml.includes('rId7'));
console.log('rId8 removed', !xml.includes('rId8'));
console.log('page breaks', (xml.match(/w:br w:type="page"/g) || []).length);
