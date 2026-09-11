/**
 * A. 链接解析层 server/utils/urlParser.js —— 独立验证
 *
 * 断言原则（来自 PRD 的入口健壮性要求）：
 *   对任意输入，detectPlatform 必须满足二者之一：
 *     1. 正确返回 { platformId, itemId }（itemId 为非空数字串）
 *     2. 抛出 ApiError，status=400，且 message 是可直接展示的中文
 *   绝不允许：返回 undefined / 抛非 ApiError / 进程崩溃。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractUrl,
  normalizeUrl,
  detectPlatform,
  extractItemId,
  buildSearchUrl,
  buildSearchKeyword,
} from '../server/utils/urlParser.js';
import { ApiError, isApiError } from '../server/utils/errors.js';

/** 安全调用：把结果统一成可断言的结构。 */
function attempt(input) {
  try {
    return { ok: true, value: detectPlatform(input) };
  } catch (err) {
    return { ok: false, err };
  }
}

/** 断言「要么解析成功，要么给出可展示的中文 400 错误」。 */
function assertGraceful(label, input) {
  const result = attempt(input);
  if (result.ok) {
    const v = result.value;
    assert.ok(v, `${label}: detectPlatform 返回了 falsy 值`);
    assert.ok(
      ['jd', 'taobao', 'pdd'].includes(v.platformId),
      `${label}: 非法 platformId=${v.platformId}`,
    );
    assert.ok(typeof v.itemId === 'string' && /^\d+$/.test(v.itemId), `${label}: 非法 itemId=${v.itemId}`);
    assert.ok(v.platformName && typeof v.platformName === 'string', `${label}: 缺少 platformName`);
  } else {
    assert.ok(isApiError(result.err), `${label}: 抛出了非 ApiError -> ${result.err}`);
    assert.equal(result.err.status, 400, `${label}: 错误状态码应为 400`);
    assert.ok(result.err.message.length > 0, `${label}: 错误信息为空`);
    assert.ok(/[一-龥]/.test(result.err.message), `${label}: 错误信息不是中文 -> ${result.err.message}`);
  }
  return result;
}

/** 断言「应当成功解析」。 */
function expectParse(label, input, platformId, itemId) {
  const result = attempt(input);
  assert.ok(result.ok, `${label}: 期望解析成功，实际抛错 -> ${result.err?.message}`);
  assert.equal(result.value.platformId, platformId, `${label}: platformId 不符`);
  assert.equal(result.value.itemId, itemId, `${label}: itemId 不符`);
}

/** 断言「应当给出 400 中文错误」。 */
function expectReject(label, input) {
  const result = attempt(input);
  assert.ok(!result.ok, `${label}: 期望拒绝，实际解析成功 -> ${JSON.stringify(result.value)}`);
  assert.ok(isApiError(result.err), `${label}: 非 ApiError`);
  assert.equal(result.err.status, 400, `${label}: 状态码应为 400，实际 ${result.err.status}`);
  assert.ok(/[一-龥]/.test(result.err.message), `${label}: 非中文错误 -> ${result.err.message}`);
}

test('A1 京东：标准商品页 / 移动版 / 香港站 / 带 sku 参数', () => {
  expectParse('jd-标准', 'https://item.jd.com/100012043978.html', 'jd', '100012043978');
  expectParse('jd-无协议', 'item.jd.com/100012043978.html', 'jd', '100012043978');
  expectParse('jd-http', 'http://item.jd.com/100012043978.html', 'jd', '100012043978');
  expectParse('jd-移动版', 'https://item.m.jd.com/product/100012043978.html', 'jd', '100012043978');
  expectParse('jd-香港站', 'https://item.jd.hk/100012043978.html', 'jd', '100012043978');
  expectParse('jd-带sku参数', 'https://item.jd.com/100012043978.html?sku=100012043979', 'jd', '100012043978');
});

test('A2 淘宝 / 天猫：item.taobao / detail.tmall / a.m.taobao 短路径', () => {
  expectParse('tb-标准', 'https://item.taobao.com/item.htm?id=12345678901', 'taobao', '12345678901');
  expectParse(
    'tmall-带sku_properties',
    'https://detail.tmall.com/item.htm?id=12345678901&sku_properties=1627207:3232483',
    'taobao',
    '12345678901',
  );
  expectParse('tb-移动短路径', 'https://a.m.taobao.com/i123456789.htm', 'taobao', '123456789');
  expectParse('tb-itemId驼峰', 'https://item.taobao.com/item.htm?itemId=12345678901', 'taobao', '12345678901');
  expectParse('tmall-hk', 'https://detail.tmall.hk/item.htm?id=12345678901', 'taobao', '12345678901');
});

test('A3 拼多多：goods.html / goods1.html / 二级域名', () => {
  expectParse('pdd-goods', 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789', 'pdd', '123456789');
  expectParse('pdd-goods1', 'https://mobile.yangkeduo.com/goods1.html?goods_id=987654321', 'pdd', '987654321');
  expectParse('pdd-goods2', 'https://mobile.yangkeduo.com/goods2.html?goods_id=555555555', 'pdd', '555555555');
  expectParse('pdd-pinduoduo域名', 'https://m.pinduoduo.com/goods.html?goods_id=111222333', 'pdd', '111222333');
});

test('A4 分享口令文本：必须从中文 + emoji + 噪声里挖出链接', () => {
  expectParse(
    '口令-京东',
    '7👈🔐 复制这行话￥abc123￥，打开【京东APP】查看 https://item.jd.com/100012043978.html',
    'jd',
    '100012043978',
  );
  expectParse(
    '口令-淘宝',
    '9.0🗝 复制本条信息￥def456￥打开【淘宝】APP https://item.taobao.com/item.htm?id=12345678901',
    'taobao',
    '12345678901',
  );
  expectParse(
    '口令-拼多多',
    '【拼多多】复制此消息，打开APP立减 https://mobile.yangkeduo.com/goods.html?goods_id=123456789',
    'pdd',
    '123456789',
  );
  expectParse(
    '口令-末尾中文句号',
    '分享给你 https://item.jd.com/100012043978.html。',
    'jd',
    '100012043978',
  );
  expectParse(
    '口令-URL后紧跟中文',
    '快来看https://item.jd.com/100012043978.html超便宜',
    'jd',
    '100012043978',
  );
});

test('A5 边界与恶意输入：绝不返回 undefined，绝不抛未捕获异常', () => {
  const hostile = [
    ['空串', ''],
    ['空白串', '   '],
    ['null', null],
    ['undefined', undefined],
    ['纯中文', '这是一段完全没有链接的中文文案'],
    ['http://', 'http://'],
    ['https://', 'https://'],
    ['无商品ID的通用站', 'https://a.com'],
    ['javascript伪协议', 'javascript:alert(1)'],
    ['SQL注入', "'; DROP TABLE quotes; --"],
    ['尖括号XSS', '<script>alert(1)</script>'],
    ['图片标签', '<img src=x onerror=alert(1)>'],
    ['只有域名', 'jd.com'],
    ['tb.cn短链无法解析', 'https://m.tb.cn/h.eXaMpLe'],
    ['超长中文1万字符', '啊'.repeat(10000)],
    ['超长无意义ascii', 'a'.repeat(10000)],
    ['超长带链接', `${'啊'.repeat(9000)} https://item.jd.com/100012043978.html ${'啊'.repeat(1000)}`],
    ['URL嵌套URL', 'https://item.jd.com/100012043978.html?from=https://item.taobao.com/item.htm?id=12345678901'],
    ['数字字符串', '12345678'],
    ['对象', {}],
    ['数组', []],
    ['负数', -1],
    ['NaN', Number.NaN],
  ];
  for (const [label, input] of hostile) {
    assertGraceful(label, input);
  }
});

test('A6 大小写混写与协议混写不应影响识别', () => {
  expectParse('全大写', 'HTTPS://ITEM.JD.COM/100012043978.HTML', 'jd', '100012043978');
  expectParse('大小写混杂', 'HtTpS://ItEm.TaObAo.CoM/item.htm?ID=12345678901', 'taobao', '12345678901');
  expectParse('带fragment', 'https://item.jd.com/100012043978.html#/detail', 'jd', '100012043978');
  expectParse('HTML实体&', 'https://item.taobao.com/item.htm?id=12345678901&amp;sku=1', 'taobao', '12345678901');
});

test('A7 明确拒绝：非电商域名 / 无法提取 ID 的链接', () => {
  expectReject('百度', 'https://www.baidu.com/s?wd=item.jd.com');
  expectReject('谷歌', 'https://www.google.com/search?q=iphone');
  expectReject('京东首页无ID', 'https://www.jd.com/');
  expectReject('拼多多无goods_id', 'https://mobile.yangkeduo.com/goods2.html');
});

test('A8 性能：恶意超长输入不得造成正则灾难性回溯（ReDoS）', () => {
  const payloads = [
    'a'.repeat(20000),
    'a.'.repeat(10000),
    'https://'.padEnd(20000, 'a'),
    `${'啊'.repeat(20000)}`,
    'item.jd.com/'.padEnd(20000, '1'),
  ];
  for (const [index, payload] of payloads.entries()) {
    const started = Date.now();
    assertGraceful(`perf-${index}`, payload);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 1500, `perf-${index}: 解析耗时 ${elapsed}ms，疑似 ReDoS`);
  }
});

test('A9 extractUrl 契约：返回 string|null，绝不抛异常', () => {
  const inputs = ['', null, undefined, 'abc', 'https://item.jd.com/1.html', '啊', 42, {}, []];
  for (const input of inputs) {
    const out = extractUrl(input);
    assert.ok(out === null || typeof out === 'string', `extractUrl(${String(input)}) 返回了非法类型`);
  }
  assert.equal(extractUrl('https://item.jd.com/100012043978.html'), 'https://item.jd.com/100012043978.html');
  assert.equal(extractUrl('没有链接'), null);
});

test('A10 normalizeUrl / extractItemId / buildSearchUrl 契约', () => {
  assert.equal(normalizeUrl('item.jd.com/1.html'), 'https://item.jd.com/1.html');
  assert.equal(normalizeUrl('  https://x.com/a#b  '), 'https://x.com/a');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(null), '');
  assert.equal(normalizeUrl('a?b=1&amp;c=2'), 'https://a?b=1&c=2');

  assert.equal(extractItemId('jd', 'https://item.jd.com/100012043978.html'), '100012043978');
  assert.equal(extractItemId('taobao', 'https://item.taobao.com/item.htm?id=12345678901'), '12345678901');
  assert.equal(extractItemId('pdd', 'https://mobile.yangkeduo.com/goods.html?goods_id=123456789'), '123456789');
  assert.equal(extractItemId('unknown-platform', 'https://x.com'), null);
  assert.equal(extractItemId('jd', 'not a url'), null);

  assert.match(buildSearchUrl('jd', 'AOC Q27G4'), /^https:\/\/search\.jd\.com\/Search\?keyword=AOC%20Q27G4$/);
  assert.match(buildSearchUrl('taobao', '显示器'), /^https:\/\/s\.taobao\.com\/search\?q=/);
  assert.match(buildSearchUrl('pdd', '显示器'), /search_key=/);
  assert.match(buildSearchUrl('other', '显示器'), /baidu\.com/);
  assert.doesNotThrow(() => buildSearchUrl('jd', ''));
});

test('A11 buildSearchKeyword：去促销词、去括号、长度可控', () => {
  assert.equal(buildSearchKeyword('【京东自营】小米 Redmi K80 Pro 5G手机 雪岩白'), '小米 Redmi K80 Pro 5G手机 雪岩白');
  assert.equal(buildSearchKeyword('Apple AirPods Pro 3（正品包邮）'), 'Apple AirPods Pro 3');
  assert.equal(buildSearchKeyword(''), '');
  assert.equal(buildSearchKeyword(null), '');
  assert.equal(buildSearchKeyword(undefined), '');
  const long = buildSearchKeyword('A'.repeat(500));
  assert.ok(long.length <= 40, `超长标题关键词应被截断，实际 ${long.length}`);
});

test('A12 ApiError 必须可被 toApiError / isApiError 正确识别（不泄漏堆栈给前端）', async () => {
  const { toApiError } = await import('../server/utils/errors.js');
  const err = toApiError(new ApiError(400, '自定义中文'));
  assert.equal(err.status, 400);
  assert.equal(err.message, '自定义中文');
  const wrapped = toApiError(new Error('ECONNREFUSED'));
  assert.equal(wrapped.status, 500);
  assert.match(wrapped.message, /服务内部错误/);
});
