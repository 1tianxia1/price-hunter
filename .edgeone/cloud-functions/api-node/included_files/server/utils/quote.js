/**
 * ProductQuote 构造与价格计算工具。
 *
 * 全链路价格单位：分（整数）。上游返回的「元」必须先用 toCents 转换。
 */

/**
 * 把「元」转成「分」。
 * 支持 number / 数字字符串 / 带逗号的金额字符串；非法输入返回 0。
 *
 * @param {unknown} value
 * @returns {number}
 */
export function toCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100);
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^\d.-]/g, '');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
  }
  return 0;
}

/**
 * 把「分」四舍五入到整元，让券面额 / 门槛看起来自然。
 * @param {number} cents
 * @returns {number}
 */
export function roundYuan(cents) {
  return Math.round(cents / 100) * 100;
}

/**
 * 在可用券中挑出最优的一张（门槛满足且面额最大）。
 * @param {number} price 当前价（分）
 * @param {Array<{id: string, amount: number, threshold: number}>} coupons
 * @returns {{id: string, amount: number, threshold: number}|null}
 */
export function pickBestCoupon(price, coupons) {
  const usable = (coupons ?? []).filter((coupon) => (coupon.threshold ?? 0) <= price);
  if (usable.length === 0) return null;
  return usable.reduce((best, current) => (current.amount > best.amount ? current : best));
}

/**
 * 构造统一的 ProductQuote，自动计算券后价并标记最优券。
 *
 * @param {object} input
 * @param {string} input.platformId
 * @param {string} [input.itemId] 商品 ID，自建本地价格库按 (platformId, itemId) 归档
 * @param {string} input.platformName
 * @param {string} input.title
 * @param {string} input.shopName
 * @param {string} input.imageUrl
 * @param {number} input.price 当前价（分）
 * @param {Array<object>} [input.coupons]
 * @param {string} input.url
 * @param {boolean} [input.isMock]
 * @param {string} [input.note] 备注（如"同款匹配"提示）
 * @returns {object} ProductQuote
 */
export function buildQuote(input) {
  const price = Math.max(0, Math.round(input.price ?? 0));
  const coupons = (input.coupons ?? [])
    .map((coupon, index) => ({
      id: coupon.id ?? `${input.platformId}-coupon-${index}`,
      name: coupon.name ?? '优惠券',
      amount: Math.max(0, Math.round(coupon.amount ?? 0)),
      threshold: Math.max(0, Math.round(coupon.threshold ?? 0)),
      expireText: coupon.expireText ?? '',
      source: coupon.source ?? input.platformName,
      best: false,
    }))
    .filter((coupon) => coupon.amount > 0);

  const best = pickBestCoupon(price, coupons);
  if (best) {
    const matched = coupons.find((coupon) => coupon.id === best.id);
    if (matched) matched.best = true;
  }

  const finalPrice = Math.max(0, price - (best ? best.amount : 0));

  return {
    platformId: input.platformId,
    itemId: input.itemId ?? '',
    platformName: input.platformName,
    title: input.title ?? '',
    shopName: input.shopName ?? '',
    imageUrl: input.imageUrl ?? '',
    price,
    coupons,
    couponTotal: best ? best.amount : 0,
    finalPrice,
    url: input.url ?? '',
    isMock: Boolean(input.isMock),
    note: input.note ?? '',
  };
}

/**
 * 从报价列表中挑出券后价最低的一个，并算出相对最高价省了多少。
 *
 * @param {Array<object>} quotes
 * @returns {object|null}
 */
export function pickLowest(quotes) {
  const list = (quotes ?? []).filter(Boolean);
  if (list.length === 0) return null;

  let lowest = list[0];
  let highest = list[0];
  for (const quote of list) {
    if (quote.finalPrice < lowest.finalPrice) lowest = quote;
    if (quote.finalPrice > highest.finalPrice) highest = quote;
  }

  const saveAmount = Math.max(0, highest.finalPrice - lowest.finalPrice);
  const savePercent = highest.finalPrice > 0 ? Math.round((saveAmount / highest.finalPrice) * 1000) / 10 : 0;

  return {
    platformId: lowest.platformId,
    platformName: lowest.platformName,
    title: lowest.title,
    price: lowest.price,
    finalPrice: lowest.finalPrice,
    couponTotal: lowest.couponTotal,
    url: lowest.url,
    isMock: lowest.isMock,
    // 相对全网最高价的节省额；只有一个平台时自然为 0
    saveAmount,
    savePercent,
    comparedWith: highest.platformName,
    comparedWithFinalPrice: highest.finalPrice,
  };
}
