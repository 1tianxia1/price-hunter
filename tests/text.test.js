/**
 * D. 标题相似度 / 跨平台同款匹配 —— 独立验证
 *
 * 重点回归：工程师曾踩过「关键词截断到 30 字时型号被切掉，导致匹配到不同商品原型，
 * 出现『省 92.7%』荒谬结果」的严重缺陷。此处专门构造「长标题 + 型号靠后」用例复现验证。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, titleSimilarity, pickMostSimilar } from '../server/utils/text.js';
import { buildSearchKeyword } from '../server/utils/urlParser.js';
import { buildMockQuote } from '../server/adapters/mock.js';
import { pickLowest } from '../server/utils/quote.js';

/** 从 Mock 内联 SVG 里还原商品原型标签（前两个字符），用于判断落到哪个原型。 */
function archetypeLabel(quote) {
  const svg = decodeURIComponent(String(quote.imageUrl).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  const matched = svg.match(/>([^<>]*)<\/text>/);
  return matched ? matched[1] : '?';
}

/** mock.js 中的 6 个演示商品原型标题（型号均在标题靠后位置）。 */
const ARCHETYPE_TITLES = [
  '小米 Redmi K80 Pro 骁龙8至尊版 12GB+512GB 5G手机 雪岩白',
  'Apple AirPods Pro 3 主动降噪 无线蓝牙耳机 适用 iPhone',
  '联想 ThinkPad X1 Carbon AI 2026 14英寸 轻薄笔记本电脑 Ultra7 32G',
  '石头 Roborock G30 Space 扫地机器人 自动上下水 全能基站',
  'AOC 27英寸 2K 180Hz Fast IPS 电竞显示器 Q27G4',
  '德龙 Delonghi EC885 半自动意式咖啡机 家用小型 手动打奶泡',
];

test('D1 tokenize：中英文混合分词，纯空/纯符号输入返回空数组', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize('!!!???'), []);
  const tokens = tokenize('AOC Q27G4 显示器');
  assert.ok(tokens.includes('aoc'), '英文 token 缺失');
  assert.ok(tokens.includes('q27g4'), '型号 token 缺失');
  assert.ok(tokens.includes('显示'), '中文 bigram 缺失');
  // 大小写归一
  assert.deepEqual(tokenize('AOC'), tokenize('aoc'));
});

test('D2 titleSimilarity：取值范围 [0,1]，相同为 1，空串为 0', () => {
  assert.equal(titleSimilarity('AOC Q27G4', 'AOC Q27G4'), 1);
  assert.equal(titleSimilarity('', 'abc'), 0);
  assert.equal(titleSimilarity('abc', ''), 0);
  assert.equal(titleSimilarity(null, undefined), 0);
  for (const [a, b] of [
    ['AOC 27英寸 2K 180Hz 电竞显示器 Q27G4', 'Apple AirPods Pro 3 主动降噪 无线蓝牙耳机'],
    ['小米手机', '德龙咖啡机'],
  ]) {
    const score = titleSimilarity(a, b);
    assert.ok(score >= 0 && score <= 1, `相似度越界 ${score}`);
  }
});

test('D3 相似度对称性与自反性', () => {
  const a = 'AOC 27英寸 2K 180Hz Fast IPS 电竞显示器 Q27G4';
  const b = 'AOC 27英寸 2K 180Hz Fast IPS 电竞显示器 Q27G4 黑色';
  assert.equal(titleSimilarity(a, b), titleSimilarity(b, a), '相似度不对称');
  assert.equal(titleSimilarity(a, a), 1);
  assert.ok(titleSimilarity(a, b) > 0.8, `同款加颜色词应仍高度相似，实际 ${titleSimilarity(a, b)}`);
});

test('D4 阈值边界：颜色 / 容量不同应判为同款，跨品类应判为非同款', () => {
  const sameModelDifferentSpec = titleSimilarity(
    '小米 Redmi K80 Pro 12GB+512GB 雪岩白',
    '小米 Redmi K80 Pro 16GB+1TB 黑色',
  );
  assert.ok(sameModelDifferentSpec > 0.12, `同型号不同配置应判同款，实际 ${sameModelDifferentSpec}`);

  const crossCategory = titleSimilarity(
    'Apple AirPods Pro 3 主动降噪 无线蓝牙耳机',
    '德龙 Delonghi EC885 半自动意式咖啡机',
  );
  assert.ok(crossCategory < 0.12, `跨品类不应判同款，实际 ${crossCategory}`);

  // 差一个字（型号 Q27G4 vs Q27G5）
  const oneChar = titleSimilarity(
    'AOC 27英寸 2K 180Hz 电竞显示器 Q27G4',
    'AOC 27英寸 2K 180Hz 电竞显示器 Q27G5',
  );
  assert.ok(oneChar > 0.5, `仅差一个型号字符应仍高度相似，实际 ${oneChar}`);
});

test('D5 pickMostSimilar：选出最优候选、空列表返回 null、阈值生效', () => {
  assert.equal(pickMostSimilar([], 'ref'), null);
  assert.equal(pickMostSimilar(null, 'ref'), null);
  assert.equal(pickMostSimilar([null, undefined], 'ref'), null);

  const candidates = [
    { id: 'noise', title: '德龙 Delonghi EC885 半自动意式咖啡机' },
    { id: 'right', title: 'AOC 27英寸 2K 180Hz 电竞显示器 Q27G4' },
    { id: 'partial', title: 'AOC 27英寸 显示器' },
  ];
  const matched = pickMostSimilar(candidates, 'AOC 27英寸 2K 180Hz Fast IPS 电竞显示器 Q27G4');
  assert.ok(matched, '未匹配到任何候选');
  assert.equal(matched.item.id, 'right', `应选中 right，实际 ${matched.item.id}`);
  assert.ok(matched.score > 0 && matched.score <= 1);

  // 极高阈值应拒绝一切
  assert.equal(pickMostSimilar(candidates, 'AOC 显示器', 0.999), null);
});

test('D6 【关键回归】长标题 + 型号靠后：关键词被截断后仍必须命中同一商品原型', () => {
  // 型号被推到 30 字之后的超长标题（复现当年出问题的场景）
  const longTitle = '2024新款爆款 27英寸 2K 180Hz 高刷电竞屏 AOC Q27G4 显示器';

  // 前置条件：30 字截断确实会把型号切掉（这正是当年出问题的场景）
  const truncated = buildSearchKeyword(longTitle, 30);
  assert.ok(!truncated.includes('Q27G4'), `前置条件失效：30 字截断仍包含型号 -> ${truncated}`);
  // 对照：默认 40 字能保住型号
  assert.ok(buildSearchKeyword(longTitle).includes('Q27G4'), '默认 40 字应保住型号');

  // 即使只有被截断的关键词，也必须通过 title 回退命中 Q27G4 原型
  const quote = buildMockQuote({ platformId: 'pdd', itemId: '100012043978', keyword: truncated, title: longTitle });
  assert.equal(archetypeLabel(quote), 'Q2', `型号被截断后落到了错误原型 ${archetypeLabel(quote)}`);
});

test('D7 【关键回归】6 个原型标题在三家平台必须落到同一原型，不得出现荒谬省钱比例', () => {
  for (const title of ARCHETYPE_TITLES) {
    const keyword = buildSearchKeyword(title);
    const quotes = ['jd', 'taobao', 'pdd'].map((platformId) =>
      buildMockQuote({ platformId, itemId: '100012043978', keyword, title }),
    );

    const labels = quotes.map(archetypeLabel);
    assert.equal(
      new Set(labels).size,
      1,
      `标题「${title}」在三家平台落到了不同原型：${labels.join('/')}`,
    );

    const prices = quotes.map((q) => q.finalPrice);
    const max = Math.max(...prices);
    const min = Math.min(...prices);
    assert.ok(min > 0, '出现非正价格');
    assert.ok(max / min < 1.35, `标题「${title}」跨平台价差过大 ${min}~${max}（${(max / min).toFixed(2)}x）`);

    const lowest = pickLowest(quotes);
    assert.ok(lowest.savePercent < 30, `出现荒谬省钱比例 ${lowest.savePercent}%（标题：${title}）`);
  }
});

test('D8 极端输入：超长标题、纯符号、单字不得崩溃', () => {
  const inputs = ['', '啊', '?', 'a', 'A'.repeat(5000), '😀'.repeat(500), '   ', '1'];
  for (const input of inputs) {
    assert.doesNotThrow(() => titleSimilarity(input, '参考标题'), `titleSimilarity 崩溃于 ${JSON.stringify(input).slice(0, 20)}`);
    assert.doesNotThrow(() => pickMostSimilar([{ title: input }], '参考标题'));
  }
  assert.equal(titleSimilarity('啊', '啊'), 1);
  assert.equal(titleSimilarity('啊', '哦'), 0);
});
