const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const m = 'наименование нормативного';
const i = x.indexOf(m);
const plain = x
  .slice(i - 2500, i + 200)
  .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, t) => t)
  .replace(/<[^>]+>/g, '|');
console.log(plain);
