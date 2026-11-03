const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
let x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
x = x.split('[фото]').join('');
const m = 'промышленной и пожарной безопасности»';
const i = x.indexOf(m);
console.log('pos', i);
if (i >= 0) console.log(x.slice(i - 300, i + 900));
