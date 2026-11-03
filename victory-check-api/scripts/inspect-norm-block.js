const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const marker = 'В соответствии с требованиями:';
const idx = x.indexOf(marker);
const pStart = x.lastIndexOf('<w:p ', idx);
const cap = x.indexOf('(наименование нормативного', idx);
const pEnd = x.indexOf('</w:p>', cap) + '</w:p>'.length;
const seg = x.slice(pStart, pEnd);
const texts = [...seg.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
console.log('runs:', texts);
console.log('joined:', texts.join(''));
console.log('has full pattern', x.includes('«Правил по охране труда при работе на высоте»______________________'));
