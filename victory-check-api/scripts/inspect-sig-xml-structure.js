const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const start = x.indexOf('Предписание выдал');
const end = x.indexOf('ПРЕДПИСАНИЕ', start);
const seg = x.slice(start - 500, end);
// simplify: show structure
const simplified = seg
  .replace(/<w:tbl>/g, '\n[TBL]\n')
  .replace(/<\/w:tbl>/g, '\n[/TBL]\n')
  .replace(/<w:tr>/g, '\n  [TR]\n')
  .replace(/<\/w:tr>/g, '\n  [/TR]\n')
  .replace(/<w:tc>/g, '\n    [TC]')
  .replace(/<\/w:tc>/g, '[/TC]\n')
  .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '{$1}')
  .replace(/<[^>]+>/g, '');
console.log(simplified.slice(0, 3500));
