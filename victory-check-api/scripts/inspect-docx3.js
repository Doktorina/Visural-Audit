const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const tpl = path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx');
const zip = new PizZip(fs.readFileSync(tpl, 'binary'));
const xml = zip.file('word/document.xml').asText();

const markers = [5297, 54019, 61831, 92061, 158755];
markers.sort((a, b) => a - b);
for (let i = 0; i < markers.length; i++) {
  const pos = markers[i];
  const slice = xml.slice(pos, pos + 120);
  const textMatch = slice.match(/<w:t[^>]*>([^<]{1,60})/);
  console.log(`\n@${pos}:`, textMatch ? textMatch[1] : slice.slice(0, 80));
}

// extract drawing block for rId8
const start = xml.indexOf('<w:drawing>', xml.indexOf('rId8') - 500);
const end = xml.indexOf('</w:drawing>', start) + '</w:drawing>'.length;
console.log('\nDRAWING LEN', end - start);
