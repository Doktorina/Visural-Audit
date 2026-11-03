const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const tpl = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const i = tpl.indexOf('[фото]');
console.log(tpl.slice(i - 400, i + 800).replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '[$1]').replace(/<[^>]+>/g, '|'));
