const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const m = 'Приложение №1 к акту проверки';
const i = x.indexOf(m);
console.log('pos', i);
console.log(x.slice(i, i + 2000).replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '[$1]'));
