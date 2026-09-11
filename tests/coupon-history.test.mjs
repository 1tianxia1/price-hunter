import { buildQuote } from '../server/utils/quote.js';
import { normalizeHistoryPayload } from '../server/adapters/history.js';

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('\n[1] 券的 couponUrl 字段流转');
{
  const quote = buildQuote({
    platformId: 'jd',
    platformName: '京东',
    title: '测试商品',
    shopName: '京东自营',
    imageUrl: '',
    price: 100000,
    url: 'https://item.jd.com/1.html',
    coupons: [
      { id: 'a', name: '有链接的券', amount: 5000, threshold: 90000, couponUrl: 'https://coupon.m.jd.com/x?a=1&b=2' },
      { id: 'b', name: '没链接的券', amount: 3000, threshold: 0 },
    ],
  });

  const withLink = quote.coupons.find((c) => c.id === 'a');
  const withoutLink = quote.coupons.find((c) => c.id === 'b');

  check('带 couponUrl 的券保留链接', withLink?.couponUrl === 'https://coupon.m.jd.com/x?a=1&b=2');
  check('未提供 couponUrl 的券降级为空串', withoutLink?.couponUrl === '');
  check('最优券仍是面额大的那张', quote.coupons.find((c) => c.best)?.id === 'a');
  check('券后价 = 原价 - 最优券', quote.finalPrice === 95000);
}

console.log('\n[2] 大淘客 history 结构解析');
{
  const payload = {
    code: '1',
    data: {
      historicalPrice: [
        { actualPrice: 1280, date: '2022-10-24 20:00:00' },
        { actualPrice: 1530, date: '2022-10-31 14:28:48' },
        { actualPrice: 1180, date: '2022-11-05 10:00:00' },
      ],
    },
  };
  const result = normalizeHistoryPayload(payload, 128000);
  check('能解析出价格点', result?.points?.length === 3);
  check('日期被截断为 yyyy-MM-dd', result?.points?.[0]?.date === '2022-10-24');
  check('价格元转分正确', result?.points?.[0]?.price === 128000);
  check('标记为非 mock', result?.isMock === false);
}

console.log('\n[3] 空/异常输入不崩');
{
  check('空 payload 返回 null', normalizeHistoryPayload({}, 1000) === null);
  check('无 data 返回 null', normalizeHistoryPayload(null, 1000) === null);
  check('只有一个点返回 null（画不出线）', normalizeHistoryPayload({
    data: { historicalPrice: [{ actualPrice: 10, date: '2024-01-01 00:00:00' }] },
  }, 1000) === null);
}

console.log('\n[4] 大淘客同一天多个价格点去重');
{
  const payload = {
    code: '1',
    data: {
      historicalPrice: [
        { actualPrice: 100, date: '2022-10-24 08:00:00' },
        { actualPrice: 120, date: '2022-10-24 20:00:00' },
        { actualPrice: 90, date: '2022-10-25 10:00:00' },
      ],
    },
  };
  const result = normalizeHistoryPayload(payload, 9000);
  check('原始点数保留 3 个（解析层不去重）', result?.points?.length === 3);
  // recordedDays 由 history.js 用 Set 计算，这里验证语义：不同日期是 2 天
  const days = new Set(result.points.map((p) => p.date)).size;
  check('去重后应为 2 个自然日', days === 2, `实际 ${days}`);
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);
