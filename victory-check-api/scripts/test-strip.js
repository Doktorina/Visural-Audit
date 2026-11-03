const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');
const pd = require('../prescription-doc');

// test strip in isolation
const xml = `<?xml version="1.0"?><w:body><w:p><w:r><w:t>hello</w:t></w:r></w:p><w:p></w:p><w:p></w:p><w:p><w:pPr><w:sectPr/></w:pPr></w:p></w:body>`;
function stripTrailingEmptyParagraphs(xml) {
  const endTag = '</w:body>';
  const end = xml.lastIndexOf(endTag);
  if (end < 0) return xml;
  let content = xml.slice(0, end);
  const after = xml.slice(end + endTag.length);
  let removed = 0;
  while (true) {
    const match = content.match(/<w:p[^>]*>[\s\S]*?<\/w:p>\s*$/);
    if (!match) break;
    const para = match[0];
    const hasText = /<w:t[^>]*>[^<\s][^<]*<\/w:t>/.test(para);
    const hasDrawing = para.includes('<w:drawing>');
    const hasPageBreak =
      para.includes('w:br w:type="page"') || para.includes('w:pageBreakBefore w:val="1"');
    const hasSectPr = para.includes('<w:sectPr');
    if (hasSectPr) break;
    if (hasText || hasDrawing) break;
    content = content.slice(0, content.length - match[0].length);
    removed++;
  }
  console.log('removed', removed);
  return content + endTag + after;
}
console.log(stripTrailingEmptyParagraphs(xml));
