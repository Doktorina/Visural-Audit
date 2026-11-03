const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const x = new PizZip(
  fs.readFileSync(path.join(__dirname, '..', 'templates', 'akt-predpisanie.docx'), 'binary')
).file('word/document.xml').asText();
const matches = [...x.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)];
console.log('sectPr count', matches.length);
matches.forEach((m, i) => {
  console.log('\n#', i, 'before:', x.slice(m.index - 150, m.index).replace(/\s+/g, ' '));
});

// simulate strip step by step
function stripDebug(xml) {
  const endTag = '</w:body>';
  const end = xml.lastIndexOf(endTag);
  let content = xml.slice(0, end);
  let sectPr = '';
  const sectIdx = content.lastIndexOf('<w:sectPr');
  const sectEnd = content.indexOf('</w:sectPr>', sectIdx);
  sectPr = content.slice(sectIdx, sectEnd + '</w:sectPr>'.length);
  content = content.slice(0, sectIdx) + content.slice(sectEnd + '</w:sectPr>'.length);
  console.log('\nafter sect extract, ends with:', content.slice(-120).replace(/\s+/g, ' '));
  let n = 0;
  while (n < 50) {
    const trimmed = content.replace(/\s+$/, '');
    const pEnd = trimmed.lastIndexOf('</w:p>');
    if (pEnd < 0) break;
    const pStart = trimmed.lastIndexOf('<w:p', pEnd);
    if (pStart < 0) break;
    const para = trimmed.slice(pStart, pEnd + '</w:p>'.length);
    const hasText = /<w:t[^>]*>[^<\s][^<]*<\/w:t>/.test(para);
    const hasDrawing = para.includes('<w:drawing>');
    const hasPageBreak =
      para.includes('w:br w:type="page"') || para.includes('w:pageBreakBefore w:val="1"');
    if (hasText || hasDrawing || hasPageBreak) {
      console.log('stop at n=', n, 'text:', [...para.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('|').slice(0, 60));
      break;
    }
    content = trimmed.slice(0, pStart);
    n++;
  }
  const out = content + sectPr + endTag;
  console.log('removed', n, 'paras');
  console.log('balance', (out.match(/<w:p[\s>]/g) || []).length, (out.match(/<\/w:p>/g) || []).length);
  console.log('tail:', out.slice(-250).replace(/\s+/g, ' '));
}

stripDebug(x);
