const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const marker = 'Специалист службы охраны труда';
const tableStart = x.indexOf(marker);
const tblStart = x.lastIndexOf('<w:tbl>', tableStart);
const tblEnd = x.indexOf('</w:tbl>', tableStart) + '</w:tbl>'.length;
const table = x.slice(tblStart, tblEnd);
console.log('has tblGrid', table.includes('<w:tblGrid>'));
const gridCols = (table.match(/<w:gridCol /g) || []).length;
console.log('gridCol count', gridCols);
const rows = table.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
console.log('rows', rows.length);
rows.forEach((r, i) => {
  const cells = r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
  const texts = [...r.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|');
  console.log(`row ${i}: ${cells.length} cells, text: ${texts.slice(0, 120)}`);
  cells.forEach((c, j) => {
    const w = c.match(/w:w="([^"]+)"/);
    const tcW = c.includes('<w:tcW ');
    console.log(`  cell ${j}: tcW=${tcW} width=${w ? w[1] : 'none'}`);
  });
});
