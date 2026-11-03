const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const tpl = path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx');
const zip = new PizZip(fs.readFileSync(tpl, 'binary'));
const xml = zip.file('word/document.xml').asText();
const rels = zip.file('word/_rels/document.xml.rels').asText();

console.log('MEDIA FILES:', Object.keys(zip.files).filter((k) => k.startsWith('word/media/')));
console.log('RELS:', rels);
const texts = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
const joined = texts.join('|');
['ПРЕДПИСАНИЕ', 'Приложение', 'Акт проверки', 'image', 'br type="page"'].forEach((s) => {
  const i = xml.indexOf(s);
  console.log(s, i >= 0 ? 'found at ' + i : 'NOT FOUND');
});
const pageBreaks = (xml.match(/w:br[^>]*w:type="page"/g) || []).length;
console.log('page breaks:', pageBreaks);
