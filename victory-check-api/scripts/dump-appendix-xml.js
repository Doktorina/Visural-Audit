const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
let x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
x = x.split('[фото]').join('');
const i = x.indexOf('промышленной и пожарной безопасности');
console.log(x.slice(i - 100, i + 1200));
