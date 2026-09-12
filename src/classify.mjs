const FOLDER_HINTS = [
  [/reading|reference|chapter|paper/, '阅读'],
  [/assignment|homework|quiz|\blab\b|project|作业/, '作业'],
  [/lecture|slide|material|课件|讲义/, '讲义'],
];

const asciiWord = (kw) => '(^|[^a-z])' + kw + '($|[^a-z])';

export function classifyFile({ filename = '', folderFullName = '', source = 'file', config = {} }) {
  if (source === 'assignment') return '作业';
  const f = filename.toLowerCase();
  const fp = (folderFullName || '').toLowerCase();
  for (const [cat, kws] of Object.entries(config.classify || {})) {
    for (const kw of kws) {
      const k = String(kw).toLowerCase();
      if (!k) continue;
      const isCJK = /[\u4e00-\u9fff]/.test(k);
      const matched = isCJK ? f.includes(k) : new RegExp(asciiWord(k)).test(f);
      if (matched) return cat;
    }
  }
  for (const [re, cat] of FOLDER_HINTS) if (re.test(fp)) return cat;
  if (/week\s*\d/i.test(fp) && /\.(pdf|pptx?|docx?|key|txt)$/i.test(filename)) return '讲义';
  return '其他';
}

export function categoryOfPath(relPath) {
  for (const cat of ['讲义', '作业', '阅读', '其他']) {
    if ((relPath || '').split('/').includes(cat)) return cat;
  }
  return '其他';
}
