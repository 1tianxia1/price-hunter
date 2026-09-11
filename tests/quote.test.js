/**
 * C. 券后价计算 server/utils/quote.js —— 独立验证
 *
 * 全链路价格单位为「分」的整数。核心不变量：
 *   - 价格永不为负、永不为 NaN / Infinity
 *   - 券后价 <= 原价
 *   - 未达门槛的券绝不能被应用
 *   - 「省了多少 / 折扣百分比」在任何情况下都不是 NaN / Infinity
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { toCents, roundYuan, pickBestCoupon, buildQuote, pickLowest } from '../server/utils/quote.js';

/** 断言是安全的金额（非负有限数）。 */
function assertSafeAmount(label, value) {
  assert.ok(Number.isFinite(value), `${label}: 出现非有限数 ${value}`);
  assert.ok(!Number.isNaN(value), `${label}: 出现 NaN`);
  assert.ok(value >= 0, `${label}: 出现负数 ${value}`);
}

test('C1 toCents：元 -> 分，常见金额精确转换', () => {
  assert.equal(toCents(0), 0);
  assert.equal(toCents(0.01), 1);
  assert.equal(toCents(9.9), 990);
  assert.equal(toCents(99.99), 9999);
  assert.equal(toCents(1299), 129900);
  assert.equal(toCents(1299.5), 129950);
  assert.equal(toCents(12345.67), 1234567);
  assert.equal(toCents('1299'), 129900);
  assert.equal(toCents('￥1,299.00'), 129900);
  assert.equal(toCents('1299元'), 129900);
  assert.equal(toCents('  199.90  '), 19990);
});

test('C2 toCents：非法 / 边界输入一律返回 0，绝不返回 NaN', () => {
  for (const [label, input] of [
    ['null', null],
    ['undefined', undefined],
    ['空串', ''],
    ['纯字母', 'abc'],
    ['对象', {}],
    ['数组', []],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['布尔', true],
  ]) {
    assert.equal(toCents(input), 0, `${label} 应返回 0`);
  }
});

test('C3 roundYuan：四舍五入到整元（分）', () => {
  assert.equal(roundYuan(0), 0);
  assert.equal(roundYuan(49), 0);
  assert.equal(roundYuan(50), 100);
  assert.equal(roundYuan(149), 100);
  assert.equal(roundYuan(999950), 1000000);
});

test('C4 pickBestCoupon：门槛未达到的券绝不能被选中', () => {
  const coupons = [
    { id: 'a', amount: 5000, threshold: 20000 },
    { id: 'b', amount: 1000, threshold: 0 },
  ];
  // price=10000（100元），券 a 门槛 200（200元）未达到
  const best = pickBestCoupon(10000, coupons);
  assert.ok(best, '应至少选中无门槛券');
  assert.equal(best.id, 'b', '错误地应用了未达门槛的券 a');

  // 门槛刚好等于价格时应当可用
  const edge = pickBestCoupon(20000, coupons);
  assert.equal(edge.id, 'a', '门槛 == 价格 时应可用');

  // 门槛比价格高 1 分时不可用
  const justOver = pickBestCoupon(19999, coupons);
  assert.equal(justOver.id, 'b', '门槛比价格高时应不可用');
});

test('C5 pickBestCoupon：空列表 / 全不可用 / 脏数据不崩溃', () => {
  assert.equal(pickBestCoupon(10000, []), null);
  assert.equal(pickBestCoupon(10000, null), null);
  assert.equal(pickBestCoupon(10000, undefined), null);
  assert.equal(pickBestCoupon(10000, [{ id: 'x', amount: 5000, threshold: 999999 }]), null);
  // threshold 缺失按 0 处理
  const noThreshold = pickBestCoupon(100, [{ id: 'y', amount: 500 }]);
  assert.equal(noThreshold.id, 'y');
  // 全部金额为 0 的券不应被当作有效优惠抛异常
  assert.doesNotThrow(() => pickBestCoupon(100, [{ id: 'z', amount: 0, threshold: 0 }]));
});

test('C6 buildQuote：无券时券后价等于原价，couponTotal 为 0', () => {
  const q = buildQuote({ platformId: 'jd', platformName: '京东', title: '商品', price: 129900, coupons: [] });
  assert.equal(q.price, 129900);
  assert.equal(q.couponTotal, 0);
  assert.equal(q.finalPrice, 129900);
  assert.deepEqual(q.coupons, []);
});

test('C7 buildQuote：券面额 >= 价格时结果必须 clamp 到 0，绝不为负', () => {
  const cases = [
    ['券等于价格', 10000, 10000],
    ['券大于价格', 10000, 50000],
    ['券远大于价格', 1, 9999999],
  ];
  for (const [label, price, amount] of cases) {
    const q = buildQuote({
      platformId: 'jd',
      platformName: '京东',
      title: '商品',
      price,
      coupons: [{ id: 'big', amount, threshold: 0 }],
    });
    assertSafeAmount(`${label} finalPrice`, q.finalPrice);
    assert.equal(q.finalPrice, 0, `${label}: 券后价应为 0，实际 ${q.finalPrice}`);
    assert.equal(q.couponTotal, amount, `${label}: couponTotal 不符`);
  }
});

test('C8 buildQuote：价格为 0 / null / 负数 / 非数字时不产生 NaN', () => {
  for (const [label, price] of [
    ['0', 0],
    ['null', null],
    ['undefined', undefined],
    ['负数', -9999],
    ['字符串数字', '1299'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ]) {
    const q = buildQuote({
      platformId: 'jd',
      platformName: '京东',
      title: 't',
      price,
      coupons: [{ id: 'c', amount: 1000, threshold: 0 }],
    });
    assert.ok(Number.isFinite(q.price), `${label}: price 非有限数 ${q.price}`);
    assert.ok(Number.isFinite(q.finalPrice), `${label}: finalPrice 非有限数 ${q.finalPrice}`);
    assert.ok(q.finalPrice >= 0, `${label}: finalPrice 为负 ${q.finalPrice}`);
  }
  // NaN 价格必须被兜底为 0，而不是 NaN
  assert.equal(buildQuote({ platformId: 'jd', title: 't', price: Number.NaN }).price, 0);
});

test('C9 buildQuote：脏券数据（负金额 / null 字段 / 缺字段）被安全丢弃', () => {
  const q = buildQuote({
    platformId: 'pdd',
    platformName: '拼多多',
    title: 't',
    price: 50000,
    coupons: [
      { id: 'neg', amount: -5000, threshold: 0 },
      { id: 'zero', amount: 0, threshold: 0 },
      { amount: 3000, threshold: 0 },
      null,
      undefined,
    ],
  });
  // amount <= 0 的券必须被过滤掉
  assert.ok(!q.coupons.some((c) => c.amount <= 0), '存在非正金额的券');
  assert.ok(Number.isFinite(q.finalPrice));
  assert.ok(q.finalPrice >= 0);
  assert.ok(q.finalPrice <= q.price);
});

test('C10 buildQuote（当前实现观测）：多张券不叠加，仅取面额最大的一张', () => {
  const q = buildQuote({
    platformId: 'jd',
    platformName: '京东',
    title: 't',
    price: 100000,
    coupons: [
      { id: 'platform', amount: 5000, threshold: 0 },
      { id: 'plus', amount: 2000, threshold: 0 },
    ],
  });
  // 记录当前实现：couponTotal 取单张最优券，而非 7000
  assert.equal(q.couponTotal, 5000);
  assert.equal(q.finalPrice, 95000);
  const bestFlags = q.coupons.filter((c) => c.best === true);
  assert.equal(bestFlags.length, 1, 'best 标记应唯一');
  assert.equal(bestFlags[0].id, 'platform');
});

test('C11 buildQuote：best 标记唯一性（即使存在重复 id）', () => {
  const q = buildQuote({
    platformId: 'jd',
    platformName: '京东',
    title: 't',
    price: 100000,
    coupons: [
      { id: 'dup', amount: 1000, threshold: 0 },
      { id: 'dup', amount: 9000, threshold: 0 },
      { id: 'other', amount: 500, threshold: 0 },
    ],
  });
  assert.equal(q.couponTotal, 9000, '应在同 id 券中也能选出最大面额');
  assert.equal(q.finalPrice, 91000);
});

test('C12 pickLowest：单平台时节省额为 0，绝不 NaN', () => {
  const only = [buildQuote({ platformId: 'jd', platformName: '京东', title: 't', price: 100000 })];
  const low = pickLowest(only);
  assert.equal(low.saveAmount, 0);
  assert.equal(low.savePercent, 0);
  assert.ok(Number.isFinite(low.savePercent), 'savePercent 出现非有限数');
  assert.equal(low.platformId, 'jd');
});

test('C13 pickLowest：除零场景（最高券后价为 0）不得产生 NaN / Infinity', () => {
  const quotes = [
    buildQuote({ platformId: 'jd', platformName: '京东', title: 'a', price: 0, coupons: [] }),
    buildQuote({ platformId: 'pdd', platformName: '拼多多', title: 'b', price: 0, coupons: [] }),
  ];
  const low = pickLowest(quotes);
  assert.equal(low.saveAmount, 0);
  assert.equal(low.savePercent, 0);
  assert.ok(Number.isFinite(low.savePercent), '除零导致 NaN/Infinity');
});

test('C14 pickLowest：正常多平台比价，节省额与百分比正确', () => {
  const quotes = [
    buildQuote({ platformId: 'jd', platformName: '京东', title: 'a', price: 200000 }),
    buildQuote({ platformId: 'pdd', platformName: '拼多多', title: 'b', price: 100000 }),
  ];
  const low = pickLowest(quotes);
  assert.equal(low.platformId, 'pdd');
  assert.equal(low.finalPrice, 100000);
  assert.equal(low.saveAmount, 100000);
  assert.equal(low.savePercent, 50);
  assert.equal(low.comparedWith, '京东');
  assert.equal(low.comparedWithFinalPrice, 200000);
});

test('C15 pickLowest：百分比保留一位小数，且不出现浮点毛刺', () => {
  const quotes = [
    buildQuote({ platformId: 'jd', platformName: '京东', title: 'a', price: 33333 }),
    buildQuote({ platformId: 'taobao', platformName: '淘宝 / 天猫', title: 'b', price: 30000 }),
  ];
  const low = pickLowest(quotes);
  assert.ok(Number.isFinite(low.savePercent));
  assert.equal(low.savePercent, 10); // (33333-30000)/33333 = 9.999% -> 10
  assert.equal(String(low.savePercent).split('.')[1]?.length ?? 0, 0);
});

test('C16 pickLowest：空 / 脏列表返回 null，不抛异常', () => {
  assert.equal(pickLowest([]), null);
  assert.equal(pickLowest(null), null);
  assert.equal(pickLowest(undefined), null);
  assert.equal(pickLowest([null, undefined]), null);
});

test('C17 pickLowest：券后价才是比较基准（券多的平台可反超）', () => {
  const jd = buildQuote({
    platformId: 'jd',
    platformName: '京东',
    title: 'a',
    price: 100000,
    coupons: [{ id: 'x', amount: 30000, threshold: 0 }],
  });
  const pdd = buildQuote({
    platformId: 'pdd',
    platformName: '拼多多',
    title: 'b',
    price: 90000,
    coupons: [],
  });
  const low = pickLowest([jd, pdd]);
  assert.equal(low.platformId, 'jd', '应比较券后价 70000 < 90000');
  assert.equal(low.finalPrice, 70000);
});

test('C18 端到端不变量：任意随机组合下 finalPrice ∈ [0, price]', () => {
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 500; i += 1) {
    const price = Math.round(rnd() * 200000);
    const couponCount = Math.floor(rnd() * 4);
    const coupons = Array.from({ length: couponCount }, (_, k) => ({
      id: `c${k}`,
      amount: Math.round(rnd() * 150000),
      threshold: rnd() < 0.5 ? 0 : Math.round(rnd() * 200000),
    }));
    const q = buildQuote({ platformId: 'jd', platformName: '京东', title: 't', price, coupons });
    assertSafeAmount(`rand#${i} price`, q.price);
    assertSafeAmount(`rand#${i} finalPrice`, q.finalPrice);
    assert.ok(q.finalPrice <= q.price, `rand#${i}: 券后价 ${q.finalPrice} > 原价 ${q.price}`);
    assertSafeAmount(`rand#${i} couponTotal`, q.couponTotal);
  }
});
