const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');
const db = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'db.json'), 'utf8'));
const v = {
  ...db.violations[0],
  number: 'TEST/P',
  media: [],
  createdAt: '2026-06-15T10:00:00.000Z',
  createdByName: 'Е.О. Чудинова',
};
const xml = new PizZip(
  pd.generatePrescriptionDocx(v, db, { object: db.objects[0], contractor: db.contractors[0] }).buffer
).file('word/document.xml').asText();
const end = xml.lastIndexOf('</w:body>');
const tail = xml.slice(end - 8000, end + 20);
const si = tail.indexOf('sectPr');
console.log('sectPr context:', tail.slice(si - 300, si + 400).replace(/\s+/g, ' ').slice(0, 500));
const sectMatch = xml.slice(0, end).match(/<w:p[^>]*>[\s\S]*?<w:sectPr[\s\S]*?<\/w:p>\s*$/);
console.log('sectMatch', !!sectMatch, sectMatch ? sectMatch[0].length : 0);
const emptyAtEnd = [...xml.slice(0, end).matchAll(/<w:p[^>]*>[\s\S]*?<\/w:p>/g)]
  .map((m) => m[0])
  .filter((p) => !/<w:t[^>]*>[^<\s][^<]*<\/w:t>/.test(p) && !p.includes('<w:drawing>'));
console.log('empty paras total', emptyAtEnd.length, 'last 5 lengths', emptyAtEnd.slice(-5).map((p) => p.length));
