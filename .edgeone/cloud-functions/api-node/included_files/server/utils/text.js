/**
 * 文本相似度工具：用于跨平台「同款匹配」（按标题关键词模糊匹配，见规格卡 A3）。
 */

/**
 * 中英文混合分词：英文 / 数字按词，中文按二元组（bigram）。
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const value = String(text ?? '').toLowerCase();
  /** @type {string[]} */
  const tokens = [];

  for (const match of value.match(/[a-z0-9]+/g) ?? []) {
    if (match.length >= 2) tokens.push(match);
  }

  const cjk = value
    .replace(/[^\u4e00-\u9fa5]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (const segment of cjk.split(' ')) {
    if (!segment) continue;
    if (segment.length === 1) {
      tokens.push(segment);
      continue;
    }
    for (let i = 0; i + 2 <= segment.length; i += 1) {
      tokens.push(segment.slice(i, i + 2));
    }
  }

  return tokens;
}

/**
 * Dice 系数相似度，取值 [0, 1]。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function titleSimilarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }

  return (2 * intersection) / (setA.size + setB.size);
}

/**
 * 从一堆候选里挑出与参考标题最相似的一个。
 * @param {Array<{title: string}>} candidates
 * @param {string} referenceTitle
 * @param {number} [threshold] 低于该相似度视为「非同款」
 * @returns {{item: any, score: number}|null}
 */
export function pickMostSimilar(candidates, referenceTitle, threshold = 0.12) {
  let best = null;
  let bestScore = 0;

  for (const candidate of candidates ?? []) {
    const score = titleSimilarity(candidate?.title ?? '', referenceTitle);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  if (!best || bestScore < threshold) return null;
  return { item: best, score: Math.round(bestScore * 100) / 100 };
}
