import { buildQuote, toCents } from '../utils/quote.js';
import { httpJson } from '../utils/http.js';
import { signPddDdk, unixSeconds } from '../utils/sign.js';
import { extractItemId, buildSearchUrl } from '../utils/urlParser.js';
import { pickMostSimilar } from '../utils/text.js';
import { upstreamError } from '../utils/errors.js';
import { buildMockQuote } from './mock.js';

/**
 * 多多进宝 Adapter。
 *
 * 签名规则（官方）：
 *   1. 除 sign 外所有参数（含 client_id / timestamp / data_type / type 及业务参数）按参数名升序；
 *   2. 拼接成 `key1value1key2value2...`；
 *   3. 首尾各包一层 clientSecret；
 *   4. MD5 后转大写。
 *
 * 注意：多多进宝的 timestamp 是**秒级** Unix 时间戳。
 */

const PLATFORM_ID = 'pdd';
const PLATFORM_NAME = '拼多多';
const GATEWAY_URL = 'https://gw-api.pinduoduo.com/api/router';

/** @returns {boolean} 是否已配置多多进宝密钥 */
function hasKeys() {
  return Boolean(process.env.PDD_CLIENT_ID && process.env.PDD_CLIENT_SECRET);
}

/**
 * 从链接提取拼多多商品 ID（goods_id）。
 * @param {string} url
 * @returns {string|null}
 */
export function parseUrl(url) {
  return extractItemId(PLATFORM_ID, url);
}

/**
 * 调用多多进宝网关。
 * @param {string} type API 方法名
 * @param {Record<string, unknown>} bizParams 业务参数
 * @returns {Promise<any>}
 */
async function callGateway(type, bizParams) {
  const clientId = process.env.PDD_CLIENT_ID ?? '';
  const clientSecret = process.env.PDD_CLIENT_SECRET ?? '';

  const params = {
    type,
    client_id: clientId,
    timestamp: unixSeconds(),
    data_type: 'JSON',
    ...bizParams,
  };

  if (process.env.PDD_PID) {
    params.pid = process.env.PDD_PID;
  }

  params.sign = signPddDdk(params, clientSecret);

  return httpJson(GATEWAY_URL, { method: 'POST', form: params, timeout: 8000 });
}

/**
 * 校验多多进宝响应体里有没有业务层错误，有则抛出可行动的中文异常。
 * @param {any} payload
 * @returns {void}
 */
function assertNoPddError(payload) {
  const errResp = payload?.error_response;
  if (errResp) {
    throw upstreamError(
      '多多进宝',
      errResp.error_code ?? errResp.errorResponse?.error_code ?? 'UNKNOWN',
      errResp.error_msg ?? errResp.errorResponse?.error_msg ?? '未知错误',
    );
  }
}

/**
 * 把多多进宝商品对象映射成统一中间结构。
 * @param {any} item
 * @returns {{title: string, shopName: string, imageUrl: string, price: number, coupons: object[], goodsId: string}}
 */
function normalizeItem(item) {
  const price = toCents(
    item?.min_group_price ?? item?.minGroupPrice ?? item?.min_normal_price ?? 0,
  );

  const coupons = [];
  const couponDiscount = toCents(item?.coupon_discount ?? item?.couponDiscount ?? 0);
  if (couponDiscount > 0) {
    coupons.push({
      id: 'pdd-coupon-0',
      name: '拼多多商品券',
      amount: couponDiscount,
      threshold: toCents(item?.coupon_min_order_amount ?? item?.couponMinOrderAmount ?? 0),
      expireText:
        item?.coupon_end_time || item?.couponEndTime
          ? `${formatPddTime(item?.coupon_end_time ?? item?.couponEndTime)} 前有效`
          : '以商品页为准',
      source: item?.mall_name ?? PLATFORM_NAME,
      // 详情接口可能带 coupon_url；没有时前端回退到「去商品页领券」
      couponUrl: String(item?.coupon_url ?? item?.couponUrl ?? '').trim(),
    });
  }

  // 店铺收藏券（clt_cpn_*）是另一类券，单独成条，避免被主券覆盖
  const mallCoupon = toCents(item?.mall_coupon_discount_pct ?? 0);
  if (!couponDiscount && mallCoupon > 0) {
    coupons.push({
      id: 'pdd-mall-coupon-0',
      name: '店铺收藏券',
      amount: mallCoupon,
      threshold: toCents(item?.mall_coupon_min_order_amount ?? 0),
      expireText: item?.mall_coupon_end_time
        ? `${formatPddTime(item.mall_coupon_end_time)} 前有效`
        : '以商品页为准',
      source: item?.mall_name ?? PLATFORM_NAME,
      couponUrl: String(item?.mall_coupon_url ?? '').trim(),
    });
  }

  return {
    title: item?.goods_name ?? item?.goodsName ?? '',
    shopName: item?.mall_name ?? item?.mallName ?? '拼多多店铺',
    imageUrl: item?.goods_thumbnail_url ?? item?.goodsThumbnailUrl ?? item?.goods_image_url ?? '',
    price,
    coupons,
    goodsId: String(item?.goods_id ?? item?.goodsId ?? ''),
    goodsSign: String(item?.goods_sign ?? item?.goodsSign ?? ''),
  };
}

/**
 * 拼多多时间字段是**秒级** Unix 时间戳，也可能直接是字符串。
 * 统一输出 `yyyy-MM-dd`。
 * @param {unknown} value
 * @returns {string}
 */
function formatPddTime(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(value * 1000).toISOString().slice(0, 10);
  }
  return String(value ?? '').slice(0, 10);
}

/**
 * 查询商品报价。无 Key 或调用失败时降级为 Mock。
 * @param {string} itemId
 * @returns {Promise<object>} ProductQuote
 */
export async function queryProduct(itemId) {
  const detailUrl = `https://mobile.yangkeduo.com/goods.html?goods_id=${itemId}`;

  if (!hasKeys()) {
    return buildMockQuote({ platformId: PLATFORM_ID, itemId, url: detailUrl });
  }

  try {
    const payload = await callGateway('pdd.ddk.goods.detail', {
      goods_id_list: JSON.stringify([String(itemId)]),
    });
    // 多多进宝业务错误形如 { error_response: { error_code, error_msg } }：
    // 权限问题必须抛出去让用户看到，不能当成「没有商品」静默降级
    assertNoPddError(payload);
    const list = payload?.goods_detail_response?.goods_details ?? [];
    const item = Array.isArray(list) ? list[0] : null;
    if (!item) {
      throw new Error('未查询到该商品，可能已下架或商品 ID 有误');
    }

    const normalized = normalizeItem(item);
    if (!normalized.price) {
      throw new Error('商品返回体缺少价格字段');
    }

    return buildQuote({
      platformId: PLATFORM_ID,
      itemId: String(itemId),
      platformName: PLATFORM_NAME,
      title: normalized.title,
      shopName: normalized.shopName,
      imageUrl: normalized.imageUrl,
      price: normalized.price,
      coupons: normalized.coupons,
      url: detailUrl,
      isMock: false,
    });
  } catch (err) {
    const fallback = buildMockQuote({ platformId: PLATFORM_ID, itemId, url: detailUrl });
    fallback.warning = `多多进宝接口调用失败，已降级为演示数据：${err?.message ?? '未知错误'}`;
    return fallback;
  }
}

/**
 * 按关键词搜索同款商品。
 * @param {string} keyword
 * @param {string} [referenceTitle]
 * @returns {Promise<object|null>}
 */
export async function searchByKeyword(keyword, referenceTitle = '') {
  if (!hasKeys()) {
    return buildMockQuote({
      platformId: PLATFORM_ID,
      keyword,
      title: referenceTitle,
      url: buildSearchUrl(PLATFORM_ID, keyword),
      note: '按标题关键词匹配的同款商品',
    });
  }

  try {
    const payload = await callGateway('pdd.ddk.goods.search', {
      keyword: String(keyword),
      page: '1',
      page_size: '10',
    });
    assertNoPddError(payload);
    const list = payload?.goods_search_response?.goods_list ?? [];
    if (!Array.isArray(list) || list.length === 0) return null;

    const matched = pickMostSimilar(
      list.map((item) => ({ raw: item, title: item?.goods_name ?? '' })),
      referenceTitle || keyword,
    );
    if (!matched) return null;

    const normalized = normalizeItem(matched.item.raw);
    if (!normalized.price) return null;

    return buildQuote({
      platformId: PLATFORM_ID,
      itemId: normalized.goodsId,
      platformName: PLATFORM_NAME,
      title: normalized.title,
      shopName: normalized.shopName,
      imageUrl: normalized.imageUrl,
      price: normalized.price,
      coupons: normalized.coupons,
      url: normalized.goodsId
        ? `https://mobile.yangkeduo.com/goods.html?goods_id=${normalized.goodsId}`
        : buildSearchUrl(PLATFORM_ID, normalized.title),
      isMock: false,
      note: `按关键词匹配的同款商品（相似度 ${matched.score}）`,
    });
  } catch {
    return null;
  }
}

/**
 * 轻量探测：验证多多进宝密钥是否真的能调通。
 *
 * ⚠️ 教训：多多进宝的 `pdd.ddk.goods.detail` 等接口**需要 access_token**（走授权），
 * 只有 client_id / client_secret 时用免授权接口（如 `pdd.ddk.goods.search`）更可靠，
 * 否则会把「缺 token」误报成「密钥无效」。故这里用搜索接口探测。
 *
 * @returns {Promise<void>} 失败时抛出带可行动文案的异常
 */
export async function probe() {
  if (!hasKeys()) throw new Error('未配置多多进宝密钥');

  try {
    const payload = await callGateway('pdd.ddk.goods.search', {
      keyword: '手机',
      page: '1',
      page_size: '10',
    });
    // 签名失败 / 权限不足会以 error_response 形式返回，这里必须抛出来
    assertNoPddError(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 最常见的是没填推广位 PID：没有它搜索接口直接拒绝，不是密钥本身的问题
    if (/pid|custom_parameters|授权备案/i.test(message)) {
      throw new Error(
        `缺少多多进宝推广位 PID：请在 .env 填入 PDD_PID（在多多进宝后台「推广位管理」创建，形如 1746425_xxx_xxx）后重试，与密钥无关`,
      );
    }
    throw err;
  }
}

export default {
  platformId: PLATFORM_ID,
  platformName: PLATFORM_NAME,
  parseUrl,
  queryProduct,
  searchByKeyword,
  hasKeys,
  probe,
};
