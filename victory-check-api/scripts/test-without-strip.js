const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const tpl = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const i = tpl.indexOf('0000008A');
console.log('found', i);
if (i >= 0) console.log(tpl.slice(i - 200, i + 400).replace(/\s+/g, ' '));

// compare without strip - patch generate
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...db.violations[0],
  number: 'GAL/2026/00114',
  media: [],
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
};

// manual generate without strip
const zip = new PizZip(fs.readFileSync(pd.TEMPLATE_PATH, 'binary'));
const docPath = 'word/document.xml';
let docXml = zip.file(docPath).asText();
const specialist = pd.formatSpecialist('Е.О. Чудинова');
const actDate = '15.06.2026';
const ctx = { object: db.objects[1], contractor: db.contractors[0], violation: v };
const prescriptionNum = pd.prescriptionNumber(v, db);
const buildReplacements = (ctx2, spec) => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'prescription-doc.js'), 'utf8');
};
// simpler: require and monkeypatch - just comment out strip in test

const orig = fs.readFileSync(path.join(__dirname, '..', 'prescription-doc.js'), 'utf8');
const withoutStrip = orig.replace('docXml = stripTrailingEmptyParagraphs(docXml);', '// stripped');
fs.writeFileSync(path.join(__dirname, '..', 'prescription-doc.js.bak'), orig);
fs.writeFileSync(path.join(__dirname, '..', 'prescription-doc.js'), withoutStrip);
delete require.cache[require.resolve('../prescription-doc')];
const pd2 = require('../prescription-doc');
const r = pd2.generatePrescriptionDocx(v, db, { object: db.objects[1], contractor: db.contractors[0] });
const xml = new PizZip(r.buffer).file('word/document.xml').asText();
console.log('without strip', {
  open: (xml.match(/<w:p[\s>]/g) || []).length,
  close: (xml.match(/<\/w:p>/g) || []).length,
});
fs.writeFileSync(path.join(__dirname, '..', 'prescription-doc.js'), orig);
