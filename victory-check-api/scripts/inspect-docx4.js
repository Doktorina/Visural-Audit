const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const tpl = path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx');
const zip = new PizZip(fs.readFileSync(tpl, 'binary'));
const xml = zip.file('word/document.xml').asText();
const pos = 158755;
console.log(xml.slice(pos, pos + 3500));
