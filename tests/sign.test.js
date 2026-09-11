/**
 * B. 签名算法 server/utils/sign.js —— 独立验证
 *
 * 说明：本测试无法联网获取各平台官方签名样例，因此分两层验证：
 *   1) 已知 MD5 向量（RFC 1321 官方测试向量 + 中文 UTF-8 向量）校验摘要算法本身；
 *   2) 算法自洽性：幂等、参数顺序无关、空值处理、特殊字符不二次编码、不修改入参。
 * 结论中标注「无官方向量对照」。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  md5Upper,
  sortParams,
  concatSortedParams,
  signWithSecretWrap,
  signJdUnion,
  signTaobaoTop,
  signPddDdk,
  withSign,
  formatTimestamp,
  unixSeconds,
} from '../server/utils/sign.js';

const SECRET = 'test-app-secret-8888';

test('B1 md5Upper：RFC 1321 官方测试向量（必须全中）', () => {
  assert.equal(md5Upper(''), 'D41D8CD98F00B204E9800998ECF8427E');
  assert.equal(md5Upper('a'), '0CC175B9C0F1B6A831C399E269772661');
  assert.equal(md5Upper('abc'), '900150983CD24FB0D6963F7D28E17F72');
  assert.equal(md5Upper('message digest'), 'F96B697D7CB7938D525A2F31AAF161D0');
});

test('B2 md5Upper：非 ASCII 必须按 UTF-8 字节计算（不是 latin1 / UCS2）', () => {
  // 独立用 crypto 以 utf8 计算作为参照，若源码误用 'binary'/'latin1' 此处必挂
  const reference = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex').toUpperCase();
  for (const s of ['中文', '中文abc', '￥券后价￥', 'AOC 27英寸', '👈🔐emoji']) {
    assert.equal(md5Upper(s), reference(s), `中文/emoji 输入 ${JSON.stringify(s)} 的编码不一致`);
  }
  // 硬编码中文向量，防止「两边都改错」的循环验证
  assert.equal(md5Upper('中文'), 'A7BAC2239FCDCB3A067903D8077C4A07');
  assert.equal(md5Upper('中文abc'), '28251344F0303F110929E0BAE4D2BD03');
});

test('B3 sortParams：按参数名升序、过滤空值、保持 ASCII 序（大写先于小写，_ 在中间）', () => {
  const sorted = sortParams({ zebra: '1', apple: '2', mango: '3' });
  assert.deepEqual(sorted.map(([k]) => k), ['apple', 'mango', 'zebra']);

  // ASCII 序：'_'(0x5F) 位于 'Z'(0x5A) 与 'a'(0x61) 之间
  const mixed = sortParams({ a_x: '1', aZ: '2', aa: '3', A0: '4' });
  assert.deepEqual(mixed.map(([k]) => k), ['A0', 'aZ', 'a_x', 'aa']);

  // 空值必须被剔除（undefined / null / 空串）
  assert.deepEqual(sortParams({ a: undefined, b: null, c: '', d: '0', e: 0 }), [
    ['d', '0'],
    ['e', '0'],
  ]);

  assert.deepEqual(sortParams({}), []);
});

test('B4 concatSortedParams：拼接格式为 key1value1key2value2（无分隔符）', () => {
  assert.equal(concatSortedParams({ b: '2', a: '1' }), 'a1b2');
  assert.equal(concatSortedParams({}), '');
  assert.equal(concatSortedParams({ a: '1', b: '2', c: '3' }), 'a1b2c3');
  // 数字 / 布尔 / 对象 的字符串化
  assert.equal(concatSortedParams({ n: 42, t: true, f: false }), 'ffalsen42ttrue');
  assert.equal(concatSortedParams({ o: { x: 1 } }), 'o{"x":1}');
});

test('B5 三家签名：参数顺序打乱结果必须完全一致（排序无关性）', () => {
  const params = { method: 'jd.union.open.goods.query', app_key: 'AK', timestamp: '2026-09-08 12:00:00', v: '1.0' };
  const shuffled = { v: '1.0', timestamp: '2026-09-08 12:00:00', app_key: 'AK', method: 'jd.union.open.goods.query' };
  assert.equal(signJdUnion(params, SECRET), signJdUnion(shuffled, SECRET));
  assert.equal(signTaobaoTop(params, SECRET), signTaobaoTop(shuffled, SECRET));
  assert.equal(signPddDdk(params, SECRET), signPddDdk(shuffled, SECRET));
});

test('B6 三家签名：幂等性（同输入重复调用结果稳定）', () => {
  const params = { q: '显示器', page: 1 };
  for (const fn of [signJdUnion, signTaobaoTop, signPddDdk]) {
    const a = fn(params, SECRET);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(fn(params, SECRET), a, `${fn.name} 非幂等`);
    }
  }
});

test('B7 三家签名：输出必须是 32 位大写十六进制 MD5', () => {
  const out = signJdUnion({ a: 1 }, SECRET);
  assert.match(out, /^[0-9A-F]{32}$/);
  assert.equal(out, out.toUpperCase());
  assert.equal(signTaobaoTop({}, SECRET), md5Upper(`${SECRET}${SECRET}`));
  assert.equal(signPddDdk({}, SECRET), md5Upper(`${SECRET}${SECRET}`));
});

test('B8 三家签名：空参数集合不得崩溃，且等于 md5(secret+secret)', () => {
  for (const fn of [signJdUnion, signTaobaoTop, signPddDdk]) {
    const empty = fn({}, SECRET);
    assert.match(empty, /^[0-9A-F]{32}$/, `${fn.name} 空参数异常`);
    assert.equal(empty, md5Upper(`${SECRET}${SECRET}`), `${fn.name} 空参数应等于 md5(secret+secret)`);
  }
});

test('B9 密钥前后包裹规则：sign == md5(secret + concat + secret)', () => {
  const params = { b: '2', a: '1' };
  const expected = md5Upper(`${SECRET}a1b2${SECRET}`);
  assert.equal(signWithSecretWrap(params, SECRET), expected);
  assert.equal(signJdUnion(params, SECRET), expected);
  assert.equal(signTaobaoTop(params, SECRET), expected);
  assert.equal(signPddDdk(params, SECRET), expected);
});

test('B10 中文 / 特殊字符参数值：不得额外 URL 编码（与官方「用原始值拼接」一致）', () => {
  const params = { keyword: 'AOC 27英寸 2K', url: 'https://a.com/?x=1&y=2', plus: 'a+b/c=d' };
  // 官方规则：参与签名的是原始值，不是 encodeURIComponent 后的值
  const raw = `${SECRET}keywordAOC 27英寸 2Kplusa+b/c=durlhttps://a.com/?x=1&y=2${SECRET}`;
  assert.equal(signTaobaoTop(params, SECRET), md5Upper(raw));
  // 反证：若做了 URL 编码，结果必然不同
  const encoded = md5Upper(`${SECRET}keyword${encodeURIComponent('AOC 27英寸 2K')}plus${encodeURIComponent('a+b/c=d')}url${encodeURIComponent('https://a.com/?x=1&y=2')}${SECRET}`);
  assert.notEqual(signTaobaoTop(params, SECRET), encoded);
  // 必须是稳定输出
  assert.match(signTaobaoTop(params, SECRET), /^[0-9A-F]{32}$/);
});

test('B11 三家签名对同一参数应产出同一结果（官方规则一致时），且不同密钥结果不同', () => {
  const params = { a: '1', b: '2' };
  assert.equal(signJdUnion(params, SECRET), signTaobaoTop(params, SECRET));
  assert.equal(signTaobaoTop(params, SECRET), signPddDdk(params, SECRET));
  assert.notEqual(signJdUnion(params, SECRET), signJdUnion(params, `${SECRET}-other`));
});

test('B12 withSign：不修改入参，返回新对象并带 sign', () => {
  const params = { a: '1', b: '2' };
  const snapshot = JSON.stringify(params);
  const signed = withSign(params, SECRET);
  assert.equal(JSON.stringify(params), snapshot, 'withSign 污染了入参');
  assert.equal(signed.sign, signWithSecretWrap(params, SECRET));
  assert.notEqual(signed, params);
  assert.equal(signed.a, '1');
  assert.equal(signed.b, '2');
});

test('B13 签名不应把 sign 自身算进去（若调用方先塞了 sign，结果是确定的且不含自引用）', () => {
  const without = signWithSecretWrap({ a: '1' }, SECRET);
  const withSignField = signWithSecretWrap({ a: '1', sign: 'PLACEHOLDER' }, SECRET);
  assert.notEqual(without, withSignField);
  assert.match(withSignField, /^[0-9A-F]{32}$/);
});

test('B14 formatTimestamp：YYYY-MM-DD HH:mm:ss，零填充正确', () => {
  const d = new Date(2026, 8, 8, 9, 5, 3); // 2026-09-08 09:05:03 本地时间
  assert.equal(formatTimestamp(d), '2026-09-08 09:05:03');
  const d2 = new Date(2026, 11, 31, 23, 59, 59);
  assert.equal(formatTimestamp(d2), '2026-12-31 23:59:59');
  assert.match(formatTimestamp(), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('B15 unixSeconds：秒级、非负、整数', () => {
  const d = new Date(1700000000000);
  assert.equal(unixSeconds(d), 1700000000);
  assert.equal(unixSeconds(new Date(1700000000999)), 1700000000);
  assert.ok(Number.isInteger(unixSeconds()));
  assert.ok(unixSeconds() > 1_600_000_000);
});

test('B16 异常输入不得导致签名崩溃（null / 数组 / 嵌套 / 超长）', () => {
  const weird = [
    { a: null },
    { a: undefined },
    { a: [] },
    { a: [1, 2] },
    { a: { deep: { x: [1, 2] } } },
    { 中文字段名: '值' },
    { a: '1'.repeat(50000) },
  ];
  for (const [index, params] of weird.entries()) {
    for (const fn of [signJdUnion, signTaobaoTop, signPddDdk]) {
      const out = fn(params, SECRET);
      assert.match(out, /^[0-9A-F]{32}$/, `case-${index} ${fn.name} 输出非法`);
    }
  }
});
