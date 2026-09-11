/**
 * E. 演示数据生成器 server/adapters/mock.js —— 独立验证
 *
 * 关注三点：确定性（同 ID 结果不变）、合理性（价格为正、券后价 <= 原价）、
 * 说服力（最低价平台不能恒定是同一家）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, buildMockQuote, buildMockHistory, finalizeHistory } from '../server/adapters/mock.js';
import { pickLowest } from '../server/utils/quote.js';
import { buildSearchKeyword } from '../server/utils/urlParser.js';

const PLATFORMS = ['jd', 'taobao', 'pdd'];

/** 生成一批稳定的商品 ID。 */
function itemIds(count) {
  return Array.from({ length: count }, (_, i) => String(100012043978 + i * 7919));
}

test('E1 createRng：同种子同序列，输出落在 [0,1)', () => {
  const a = createRng('seed-1');
  const b = createRng('seed-1');
  for (let i = 0; i < 100; i += 1) {
    const va = a();
    assert.equal(va, b(), `第 ${i} 个随机数不一致`);
    assert.ok(va >= 0 && va < 1, `随机数越界 ${va}`);
  }
  assert.notEqual(createRng('seed-1')(), createRng('seed-2')());
});

test('E2 确定性：同一 itemId 重复调用结果必须完全一致', () => {
  for (const platformId of PLATFORMS) {
    for (const itemId of itemIds(20)) {
      const first = buildMockQuote({ platformId, itemId });
      const second = buildMockQuote({ platformId, itemId });
      const third = buildMockQuote({ platformId, itemId });
      assert.deepEqual(second, first, `${platformId}/${itemId} 第二次调用结果不一致`);
      assert.deepEqual(third, first, `${platformId}/${itemId} 第三次调用结果不一致`);
    }
  }
});

test('E3 确定性：跨进程等价（同种子哈希序列稳定）', () => {
  // 与 E1 互补：确保没有依赖 Date.now() / Math.random() 等进程级状态
  const q1 = buildMockQuote({ platformId: 'jd', itemId: '100012043978' });
  const serialized = JSON.stringify(q1);
  const q2 = buildMockQuote({ platformId: 'jd', itemId: '100012043978' });
  assert.equal(JSON.stringify(q2), serialized);
  assert.ok(!/NaN|Infinity|undefined/.test(serialized), `序列化结果含非法值：${serialized.slice(0, 200)}`);
});

test('E4 结构完整性：ProductQuote 必填字段齐全且类型正确', () => {
  const q = buildMockQuote({ platformId: 'taobao', itemId: '12345678901' });
  for (const field of [
    'platformId',
    'platformName',
    'title',
    'shopName',
    'imageUrl',
    'price',
    'coupons',
    'couponTotal',
    'finalPrice',
    'url',
    'isMock',
    'note',
  ]) {
    assert.ok(field in q, `缺少字段 ${field}`);
  }
  assert.equal(q.platformId, 'taobao');
  assert.equal(q.isMock, true);
  assert.ok(Array.isArray(q.coupons));
  assert.ok(q.title.length > 0, '标题为空');
  assert.ok(q.shopName.length > 0, '店铺名为空');
  assert.ok(String(q.imageUrl).startsWith('data:image/svg+xml'), '图片不是内联 SVG');
  assert.ok(Number.isInteger(q.price), `price 不是整数 ${q.price}`);
  assert.ok(Number.isInteger(q.finalPrice), `finalPrice 不是整数 ${q.finalPrice}`);
});

test('E5 价格合理性：价格为正、有限、券后价 <= 原价、券必须生效', () => {
  for (const platformId of PLATFORMS) {
    for (const itemId of itemIds(60)) {
      const q = buildMockQuote({ platformId, itemId });
      assert.ok(Number.isFinite(q.price) && q.price > 0, `${platformId}/${itemId} 价格非法 ${q.price}`);
      assert.ok(!Number.isNaN(q.finalPrice), `${platformId}/${itemId} finalPrice 为 NaN`);
      assert.ok(q.finalPrice >= 0, `${platformId}/${itemId} 券后价为负 ${q.finalPrice}`);
      assert.ok(q.finalPrice <= q.price, `${platformId}/${itemId} 券后价 ${q.finalPrice} > 原价 ${q.price}`);
      assert.ok(q.finalPrice < q.price, `${platformId}/${itemId} 券未生效（券后价 == 原价）`);
      assert.ok(q.couponTotal > 0, `${platformId}/${itemId} 券面额为 0`);
      for (const coupon of q.coupons) {
        assert.ok(coupon.amount > 0, `券面额非正 ${coupon.amount}`);
        assert.ok(coupon.threshold >= 0 && coupon.threshold <= q.price, `券门槛越界 ${coupon.threshold}`);
      }
      assert.equal(q.coupons.filter((c) => c.best).length, 1, 'best 券标记不唯一');
    }
  }
});

test('E6 说服力：最低价平台不能恒定是同一家（200 个样本须覆盖三家）', () => {
  const distribution = { jd: 0, taobao: 0, pdd: 0 };
  for (const itemId of itemIds(200)) {
    const quotes = PLATFORMS.map((platformId) => buildMockQuote({ platformId, itemId }));
    const lowest = pickLowest(quotes);
    distribution[lowest.platformId] += 1;

    // 同时校验 pickLowest 真的取到了最小券后价
    const minFinal = Math.min(...quotes.map((q) => q.finalPrice));
    assert.equal(lowest.finalPrice, minFinal, `${itemId}: pickLowest 未取到最小值`);
  }
  for (const [platformId, count] of Object.entries(distribution)) {
    assert.ok(count > 0, `平台 ${platformId} 从未成为最低价（分布：${JSON.stringify(distribution)}）`);
  }
});

test('E7 说服力：同一商品跨平台价差应在合理区间，不出现荒谬省钱比例', () => {
  for (const itemId of itemIds(200)) {
    const quotes = PLATFORMS.map((platformId) => buildMockQuote({ platformId, itemId }));
    const finals = quotes.map((q) => q.finalPrice);
    const max = Math.max(...finals);
    const min = Math.min(...finals);
    assert.ok(max / min < 1.4, `${itemId}: 跨平台价差过大 ${min}~${max}（${(max / min).toFixed(2)}x）`);
    const lowest = pickLowest(quotes);
    assert.ok(lowest.savePercent >= 0 && lowest.savePercent <= 40, `${itemId}: 省钱比例异常 ${lowest.savePercent}%`);
  }
});

test('E8 边界：空 itemId / 空 keyword / 未知平台均不得崩溃', () => {
  assert.doesNotThrow(() => buildMockQuote({ platformId: 'jd' }));
  assert.doesNotThrow(() => buildMockQuote({ platformId: 'unknown' }));
  const q = buildMockQuote({ platformId: 'jd' });
  assert.ok(Number.isFinite(q.price) && q.price > 0);
  assert.ok(q.finalPrice >= 0 && q.finalPrice <= q.price);
});

test('E9 buildMockHistory：点数、价格合法性、末点对齐当前价、统计无 NaN', () => {
  for (const itemId of itemIds(30)) {
    const history = buildMockHistory({ seed: itemId, currentPrice: 99900, days: 180 });
    assert.equal(history.points.length, 180, `${itemId}: 点数不是 180`);
    assert.equal(history.rangeDays, 180);

    for (const point of history.points) {
      assert.match(point.date, /^\d{4}-\d{2}-\d{2}$/, `日期格式非法 ${point.date}`);
      assert.ok(Number.isFinite(point.price) && point.price > 0, `价格非法 ${point.price}`);
    }

    assert.equal(history.points[history.points.length - 1].price, 99900, '末点未对齐当前价');
    assert.equal(history.current, 99900);
    for (const field of ['max', 'min', 'avg', 'percentile', 'changeFromMax', 'changeFromAvg']) {
      assert.ok(Number.isFinite(history[field]), `${itemId}: ${field} 非有限数 ${history[field]}`);
    }
    assert.ok(history.percentile >= 0 && history.percentile <= 100, `percentile 越界 ${history.percentile}`);
    assert.ok(history.min <= history.max);
    assert.ok(history.min <= history.current, '当前价低于历史最低，矛盾');
    assert.ok(Array.isArray(history.insights) && history.insights.length >= 3);
    for (const insight of history.insights) {
      assert.ok(!/NaN|Infinity|undefined/.test(insight), `结论文案含非法值：${insight}`);
    }
  }
});

test('E10 buildMockHistory：确定性（同 seed 得到同一条价格曲线）', () => {
  const a = buildMockHistory({ seed: '100012043978', currentPrice: 99900, days: 60 });
  const b = buildMockHistory({ seed: '100012043978', currentPrice: 99900, days: 60 });
  assert.deepEqual(
    a.points.map((p) => p.price),
    b.points.map((p) => p.price),
    '同 seed 价格曲线不一致',
  );
  assert.equal(a.percentile, b.percentile);
});

test('E11 buildMockHistory：currentPrice 为 0 / null 时用基准价兜底，不得产生 0 价格', () => {
  for (const currentPrice of [0, null, undefined, -100]) {
    const history = buildMockHistory({ seed: '100012043978', currentPrice, days: 30 });
    assert.ok(history.current > 0, `currentPrice=${currentPrice} 时 current 为 ${history.current}`);
    for (const point of history.points) {
      assert.ok(point.price > 0, `出现非正价格 ${point.price}`);
    }
  }
});

test('E12 buildMockHistory：日期序列严格递增且末点为「今天」', () => {
  const history = buildMockHistory({ seed: 'x', currentPrice: 99900, days: 30 });
  const dates = history.points.map((p) => p.date);
  for (let i = 1; i < dates.length; i += 1) {
    assert.ok(dates[i] > dates[i - 1], `日期未严格递增：${dates[i - 1]} -> ${dates[i]}`);
  }
  const todayLocal = new Date();
  const expected = `${todayLocal.getFullYear()}-${String(todayLocal.getMonth() + 1).padStart(2, '0')}-${String(
    todayLocal.getDate(),
  ).padStart(2, '0')}`;
  assert.equal(dates[dates.length - 1], expected, `末点日期应为本地今天 ${expected}`);
});

test('E14 主流程端到端模拟：queryProduct(itemId) + searchByKeyword(keyword, title) 必须一致', () => {
  // 完全复刻 server/routes/compare.js 的调用顺序：
  //   1) product = adapter.queryProduct(itemId)              -> buildMockQuote({platformId, itemId})
  //   2) keyword = buildSearchKeyword(product.title)
  //   3) other.searchByKeyword(keyword, product.title)       -> buildMockQuote({platformId, keyword, title})
  for (const itemId of itemIds(200)) {
    for (const source of PLATFORMS) {
      const product = buildMockQuote({ platformId: source, itemId });
      const keyword = buildSearchKeyword(product.title) || itemId;
      const quotes = [
        product,
        ...PLATFORMS.filter((p) => p !== source).map((platformId) =>
          buildMockQuote({ platformId, keyword, title: product.title }),
        ),
      ];
      const finals = quotes.map((q) => q.finalPrice);
      const max = Math.max(...finals);
      const min = Math.min(...finals);
      assert.ok(
        max / min < 1.4,
        `${source}/${itemId}: 主流程跨平台价差过大 ${min}~${max}（${(max / min).toFixed(2)}x）`,
      );
      const lowest = pickLowest(quotes);
      assert.ok(
        lowest.savePercent <= 40,
        `${source}/${itemId}: 主流程出现荒谬省钱比例 ${lowest.savePercent}%`,
      );
    }
  }
});

test('E15 【已知缺陷】仅传 itemId（无 title/keyword）时，同一 itemId 在三家平台落到不同原型', () => {
  // 缺陷定位：mock.js pickArchetype 兜底分支用 hashString(seed)，
  // 而 seed = `${platformId}:${itemId}` 含平台名 -> 同一商品在不同平台哈希不同 -> 原型不同。
  // 真实主流程靠 title 回退规避了它，但一旦上游标题为空即会复现「省 90%」类荒谬结论。
  const labels = PLATFORMS.map((platformId) => {
    const q = buildMockQuote({ platformId, itemId: '100012043978' });
    return decodeURIComponent(String(q.imageUrl).replace(/^data:image\/svg\+xml;charset=utf-8,/, '')).match(
      />([^<>]*)<\/text>/,
    )[1];
  });
  assert.equal(
    new Set(labels).size,
    1,
    `同一 itemId 落到不同原型：${labels.join('/')}（mock.js pickArchetype 兜底种子含 platformId）`,
  );
});

test('E13 finalizeHistory：空数据 / 脏数据返回安全默认值，不抛异常', () => {
  const empty = finalizeHistory({ points: [], current: 0, isMock: true, rangeDays: 0 });
  assert.equal(empty.max, 0);
  assert.equal(empty.min, 0);
  assert.equal(empty.percentile, 0);
  assert.deepEqual(empty.insights, ['暂无历史价格数据']);

  const dirty = finalizeHistory({
    points: [null, undefined, { date: '', price: 0 }, { date: '2026-01-01', price: -5 }, { date: '2026-01-02', price: 100 }],
    current: 100,
    isMock: true,
    rangeDays: 2,
  });
  assert.equal(dirty.points.length, 1, '脏数据未被过滤');
  assert.equal(dirty.min, 100);
  assert.equal(dirty.max, 100);
  assert.equal(dirty.percentile, 0);
});
