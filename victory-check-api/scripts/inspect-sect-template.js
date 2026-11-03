const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const tpl = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const si = tpl.lastIndexOf('<w:sectPr');
console.log(tpl.slice(si - 600, si + 500).replace(/\s+/g, ' '));
