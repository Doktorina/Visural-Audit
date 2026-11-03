const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const z = new PizZip(fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary'));
const x = z.file('word/document.xml').asText();
const all = [...x.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
const joined = all.join('|');
['фото', 'Фото', 'фотографии', 'наименование нормативного'].forEach((k) => {
  const idx = joined.indexOf(k);
  if (idx >= 0) console.log(k, ':', joined.slice(Math.max(0, idx - 80), idx + 120));
  else console.log(k, ': NOT FOUND');
});

// check underline paragraphs before подпись
let pos = 0;
let n = 0;
while ((pos = x.indexOf('(подпись)', pos)) >= 0) {
  n++;
  const seg = x.slice(pos - 800, pos);
  const hasUnderline = seg.includes('w:u w:val="single"');
  const hasShelf = seg.includes('________________________________');
  console.log(`\nподпись #${n}: underline=${hasUnderline} shelf=${hasShelf}`);
  pos++;
}
