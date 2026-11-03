const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const tpl = path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx');
const zip = new PizZip(fs.readFileSync(tpl, 'binary'));
console.log(zip.file('[Content_Types].xml').asText());
