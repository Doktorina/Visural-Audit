const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const marker = 'Специалист службы охраны труда';
const tblStart = x.lastIndexOf('<w:tbl>', x.indexOf(marker));
const tblEnd = x.indexOf('</w:tbl>', x.indexOf(marker)) + '</w:tbl>'.length;
const table = x.slice(tblStart, tblEnd);
const rows = table.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
rows.forEach((r, i) => {
  const cells = r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
  console.log(`\nrow ${i} (${cells.length} cells)`);
  cells.forEach((c, j) => {
    const span = c.match(/w:val="(\d+)"/);
    const texts = [...c.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|');
    console.log(`  ${j}: gridSpan=${span ? span[1] : 1} text=${texts}`);
  });
});
