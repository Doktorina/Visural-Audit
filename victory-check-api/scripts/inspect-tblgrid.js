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
const tblPr = table.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/);
const tblGrid = table.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/);
console.log('tblPr len', tblPr ? tblPr[0].length : 0);
console.log('tblGrid', tblGrid ? tblGrid[0].replace(/></g, '>\n<') : 'MISSING');
