import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { readPdf, compactText, decodeContentStream } from '../src/pdftext.mjs';

// 跨平台自检：不依赖 Spotlight / 任何外部工具，直接在内存里造一个 PDF 并解析它。
// 用于 CI（含 Windows runner）验证「PDF 文字提取 → 字距还原」这条关键链路。

const LINES = ['Assignments 30%', 'Midterm Exam 25%', 'Final Project 40%', 'Weekly Quizzes 5%'];

function buildPdf(lines) {
  const ops = ['BT /F1 12 Tf 72 720 Td'];
  lines.forEach((line, i) => {
    if (i > 0) ops.push('0 -20 Td');
    ops.push('(' + line.replace(/([()\\])/g, '\\$1') + ') Tj');
  });
  ops.push('ET');
  const content = ops.join(' ');
  const compressed = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const head = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1');
  const tail = Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1');
  return Buffer.concat([head, compressed, tail]);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-hub-selftest-'));
const file = path.join(dir, 'syllabus-demo.pdf');
fs.writeFileSync(file, buildPdf(LINES));

const result = readPdf(file);
assert.ok(result, 'PDF 解析返回空');
assert.ok(result.raw.includes('Assignments 30%'), '原始提取应包含 Assignments 30%，实际：' + result.raw.slice(0, 200));
for (const line of LINES) {
  assert.ok(result.text.includes(line), '紧凑文本应包含「' + line + '」，实际：' + result.text.slice(0, 300));
}

// 字距还原：模拟 PDF 逐字排版
const kerned = decodeContentStream('(W) Tj (e) Tj (i) Tj (g) Tj (h) Tj (t) Tj (30%) Tj');
assert.strictEqual(compactText(kerned), 'Weight 30%', '字距还原失败，实际：' + compactText(kerned));

// 常用短词不应被粘在一起
assert.strictEqual(compactText('this is in the exam'), 'this is in the exam', '短词被误粘');

fs.rmSync(dir, { recursive: true, force: true });
console.log('✅ PDF 自检通过：提取 ' + result.text.length + ' 字符，权重关键词全部命中');
