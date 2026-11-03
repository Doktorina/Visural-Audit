const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');

// step through pipeline to find where p tags break
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...db.violations[0],
  number: 'GAL/2026/00114',
  description: 'Тест',
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
  media: [],
  normRefs: ['ПОТ'],
};

function countP(xml) {
  return {
    open: (xml.match(/<w:p[\s>]/g) || []).length,
    close: (xml.match(/<\/w:p>/g) || []).length,
  };
}

const zip = new PizZip(fs.readFileSync(pd.TEMPLATE_PATH, 'binary'));
let xml = zip.file('word/document.xml').asText();
const specialist = pd.formatSpecialist('Е.О. Чудинова');
const actDate = '15.06.2026';

const steps = [];
const pdMod = require('../prescription-doc');

// manual pipeline using internal functions - read from file
const fs2 = require('fs');
const code = fs2.readFileSync(path.join(__dirname, '..', 'prescription-doc.js'), 'utf8');

// just call generate with hooks - compare intermediate by copying logic
const r = pd.generatePrescriptionDocx(v, db, { object: db.objects[1], contractor: db.contractors[0] });
const final = new PizZip(r.buffer).file('word/document.xml').asText();
console.log('final', countP(final));

// find unclosed p - locate extra open
let depth = 0;
let lastOpen = 0;
const re = /<\/?w:p[\s>]/g;
let m;
while ((m = re.exec(final))) {
  if (m[0].startsWith('</')) depth--;
  else {
    depth++;
    lastOpen = m.index;
  }
}
console.log('depth at end', depth, 'lastOpen context:', final.slice(lastOpen, lastOpen + 200).replace(/\s+/g, ' '));
