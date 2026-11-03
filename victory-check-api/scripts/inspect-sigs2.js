const fs = require('fs');
const PizZip = require('pizzip');
const z = new PizZip(fs.readFileSync('c:/Users/operator/Desktop/WOK/victory-check-api/templates/akt-predpisanie.docx', 'binary'));
const xml = z.file('word/document.xml').asText();
const pos = xml.indexOf('Предписание выдал:');
console.log(xml.slice(pos, pos + 4000));
