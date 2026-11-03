const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

const samplePath = 'c:/Users/operator/Downloads/акт-предписание образец (1).docx';
if (!fs.existsSync(samplePath)) {
  console.error('Sample not found:', samplePath);
  process.exit(1);
}

const zip = new PizZip(fs.readFileSync(samplePath, 'binary'));
const xml = zip.file('word/document.xml').asText();

function extractTableAround(marker) {
  const idx = xml.indexOf(marker);
  if (idx < 0) return null;
  const tblStart = xml.lastIndexOf('<w:tbl', idx);
  const tblEnd = xml.indexOf('</w:tbl>', idx);
  if (tblStart < 0 || tblEnd < 0) return null;
  return xml.slice(tblStart, tblEnd + '</w:tbl>'.length);
}

const table = extractTableAround('Предписание выдал') || extractTableAround('Акт проверки получил');
if (!table) {
  console.error('Could not find signature table');
  process.exit(2);
}

console.log('has tblGrid:', table.includes('<w:tblGrid>'));
console.log('gridCol count:', (table.match(/<w:gridCol /g) || []).length);
console.log('row count:', (table.match(/<w:tr>/g) || []).length);
console.log('cell count:', (table.match(/<w:tc>/g) || []).length);

const texts = [...table.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
console.log('\nTEXT RUNS:\n', texts.join(' | '));

// Show simplified structure for the first few rows
const rows = table.match(/<w:tr>[\s\S]*?<\/w:tr>/g) || [];
rows.slice(0, 8).forEach((r, i) => {
  const cells = r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
  const t = [...r.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|');
  console.log(`\nrow ${i}: cells=${cells.length} text=${t}`);
  cells.forEach((c, j) => {
    const span = c.match(/<w:gridSpan[^>]*w:val="(\d+)"/);
    const tcW = c.match(/<w:tcW[^>]*w:w="([^"]+)"/);
    console.log(`  cell ${j}: gridSpan=${span ? span[1] : 1} tcW=${tcW ? tcW[1] : 'n/a'}`);
  });
});

