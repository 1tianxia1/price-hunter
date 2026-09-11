import { buildQuote, toCents } from '../utils/quote.js';
import { httpJson } from '../utils/http.js';
import { signJdUnion, formatTimestamp } from '../utils/sign.js';
import { extractItemId, buildSearchUrl } from '../utils/urlParser.js';
import { pickMostSimilar } from '../utils/text.js';
import { upstreamError } from '../utils/errors.js';
import { buildMockQuote } from './mock.js';

/**
 * 京东联盟 Adapter。
 *
 * 签名规则（官方）：
 *   1. 除 sign 外参数按参数名 ASCII 升序排列；
 *   2. 拼接成 `key1value1key2value2...`；
 *   3. 首尾各包一层 appSecret；
 *   4. MD5 后转大写。
 *
 * 未配置 JD_APP_KEY / JD_APP_SECRET 时直接短路返回 Mock，不发起任何网络请求。
 */

const PLATFORM_ID = 'jd';
const PLATFORM_NAME = '京东';
const GATEWAY_URL = 'https://router.jd.com/api';

/** @returns {boolean} 是否已配置京东联盟密钥 */
function hasKeys() {
  return Boolean(process.env.JD_APP_KEY && process.env.JD_APP_SECRET);
}

/**
 * 从链接提取京东商品 ID（skuId）。
 * @param {string} url
 * @returns {string|null}
 */
export function parseUrl(url) {
  return extractItemId(PLATFORM_ID, url);
}

/**
 * 调用京东联盟网关。
 * @param {string} method API 方法名
 * @param {Record<string, unknown>} paramJson 业务参数
 * @returns {Promise<any>}
 */
async function callGateway(method, paramJson) {
  const appKey = process.env.JD_APP_KEY ?? '';
  const appSecret = process.env.JD_APP_SECRET ?? '';

  const params = {
    method,
    app_key: appKey,
    format: 'json',
    v: '1.0',
    timestamp: formatTimestamp(),
    param_json: JSON.stringify(paramJson),
  };

  // 推广位 ID：可选，只有配置了才带上，不配置时行为完全不变
  if (process.env.JD_UNION_ID) {
    params.unionId = process.env.JD_UNION_ID;
  }

  params.sign = signJdUnion(params, appSecret);

  return httpJson(GATEWAY_URL, { method: 'POST', form: params, timeout: 8000 });
}

/**
 * 从网关响应里取出商品数组（result 可能是 JSON 字符串，也可能是对象）。
 * @param {any} payload
 * @returns {any[]}
 */
function extractGoodsList(payload) {
  const response = payload?.jd_union_open_goods_query_response ?? payload ?? {};
  let result = response.result;

  if (typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch {
      result = null;
    }
  }

  // result 里是业务层响应：403「无访问权限」等权限问题必须抛出去，
  // 不能当成「没有商品」静默降级，否则用户永远不知道要去后台开通接口权限
  if (result && typeof result === 'object' && result.code && Number(result.code) !== 0) {
    throw upstreamError('京东联盟', result.code, result.message ?? '未知错误');
  }

  const list = result?.data ?? result?.goodsRespList ?? result?.goodsList ?? result;
  return Array.isArray(list) ? list : [];
}

/**
 * 把京东商品对象映射成统一中间结构。
 * @param {any} item
 * @returns {{title: string, shopName: string, imageUrl: string, price: number, coupons: object[], url: string}}
 */
function normalizeItem(item) {
  const price = toCents(
    item?.priceInfo?.price ?? item?.price ?? item?.wlPrice ?? item?.jdPrice ?? 0,
  );

  const rawCoupons = item?.couponInfo?.couponList ?? item?.couponList ?? [];
  const coupons = rawCoupons
    .map((coupon, index) => ({
      id: `jd-coupon-${index}`,
      name: coupon?.couponName ?? coupon?.name ?? buildJdCouponName(coupon),
      amount: toCents(coupon?.discount ?? coupon?.couponDiscount ?? coupon?.amount ?? 0),
      threshold: toCents(coupon?.quota ?? coupon?.couponQuota ?? coupon?.threshold ?? 0),
      expireText:
        coupon?.useEndTime ?? coupon?.endTime
          ? `${formatJdTime(coupon?.useEndTime ?? coupon?.endTime)} 前有效`
          : '以商品页为准',
      source: item?.shopInfo?.shopName ?? PLATFORM_NAME,
      // 京东的叫 link（非 couponUrl），且可能被 HTML 实体转义（&amp;）——必须解码后使用
      couponUrl: decodeJdUrl(coupon?.link ?? coupon?.couponUrl ?? ''),
    }))
    .filter((coupon) => coupon.amount > 0);

  return {
    title: item?.skuName ?? item?.goodsName ?? item?.name ?? '',
    shopName: item?.shopInfo?.shopName ?? item?.shopName ?? `${PLATFORM_NAME}自营`,
    imageUrl: item?.imageInfo?.imageList?.[0]?.urlList?.[0]?.url ?? item?.imageUrl ?? '',
    price,
    // 商品推广落地页（materialUrl）；拿不到时由调用方回退到 item.jd.com 详情页
    url: String(item?.materialUrl ?? ''),
    coupons,
    commissionInfo: item?.commissionInfo ?? null,
  };
}

/**
 * 京东券没有统一名称字段时，用券种类 + 门槛拼一个可读名。
 * bindType：0 全品类 / 1 限品类 / 2 限店铺 / 3 店铺限商品券
 * @param {any} coupon
 * @returns {string}
 */
function buildJdCouponName(coupon) {
  const bindType = Number(coupon?.bindType ?? -1);
  const label = { 0: '京东全品类券', 1: '京东品类券', 2: '京东店铺券', 3: '店铺限商品券' }[bindType];
  return label ?? `${PLATFORM_NAME}优惠券`;
}

/**
 * 京东时间字段有两种形态：毫秒时间戳 / "yyyy-MM-dd HH:mm:ss" 字符串。
 * 统一输出 `yyyy-MM-dd`。
 * @param {unknown} value
 * @returns {string}
 */
function formatJdTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return String(value ?? '').slice(0, 10);
}

/**
 * 京东券链接可能返回 HTML 实体转义后的 `&amp;`（社区文档明确提到过），
 * 必须还原成 `&` 否则跳转后参数丢失、领不到券。
 * @param {unknown} value
 * @returns {string}
 */
function decodeJdUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .replace(/&quot;/gi, '"');
}

/**
 * 查询商品报价。无 Key 或调用失败时降级为 Mock。
 * @param {string} itemId
 * @returns {Promise<object>} ProductQuote
 */
export async function queryProduct(itemId) {
  const detailUrl = `https://item.jd.com/${itemId}.html`;

  if (!hasKeys()) {
    return buildMockQuote({ platformId: PLATFORM_ID, itemId, url: detailUrl });
  }

  try {
    const payload = await callGateway('jd.union.open.goods.query', {
      goodsReqDTO: { skuIds: [String(itemId)] },
    });
    const items = extractGoodsList(payload);
    const item = items[0];
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
      // 优先用联盟返回的推广落地页（带推广位），拿不到才退回标准详情页
      url: normalized.url || detailUrl,
      isMock: false,
    });
  } catch (err) {
    const fallback = buildMockQuote({ platformId: PLATFORM_ID, itemId, url: detailUrl });
    fallback.warning = `京东联盟接口调用失败，已降级为演示数据：${err?.message ?? '未知错误'}`;
    return fallback;
  }
}

/**
 * 按关键词搜索同款商品（用于跨平台比价）。
 * @param {string} keyword
 * @param {string} [referenceTitle] 原平台商品标题，用于挑选最相似的一条
 * @returns {Promise<object|null>} ProductQuote 或 null（未找到 / 调用失败）
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
    const payload = await callGateway('jd.union.open.goods.query', {
      goodsReqDTO: { keyword: String(keyword), pageIndex: 1, pageSize: 10 },
    });
    const items = extractGoodsList(payload);
    if (items.length === 0) return null;

    const matched = pickMostSimilar(
      items.map((item) => ({ raw: item, title: item?.skuName ?? item?.goodsName ?? '' })),
      referenceTitle || keyword,
    );
    if (!matched) return null;

    const normalized = normalizeItem(matched.item.raw);
    if (!normalized.price) return null;

    return buildQuote({
      platformId: PLATFORM_ID,
      itemId: String(matched.item.raw?.skuId ?? ''),
      platformName: PLATFORM_NAME,
      title: normalized.title,
      shopName: normalized.shopName,
      imageUrl: normalized.imageUrl,
      price: normalized.price,
      coupons: normalized.coupons,
      // 优先商品直达页（materialUrl → item.jd.com/skuId），拿不到才退回搜索页
      url:
        normalized.url ||
        (matched.item.raw?.skuId ? `https://item.jd.com/${matched.item.raw.skuId}.html` : '') ||
        buildSearchUrl(PLATFORM_ID, normalized.title || keyword),
      isMock: false,
      note: `按关键词匹配的同款商品（相似度 ${matched.score}）`,
    });
  } catch {
    // 跨平台搜索失败不应影响主流程，直接不参与比价。
    return null;
  }
}

/**
 * 轻量探测：验证密钥是否真的能调通京东联盟。
 *
 * 用途是「数据状态」面板——区分「没配 Key」和「配了但调不通」。
 * 故意用一个必然存在的公开 SKU 做一次最小查询：
 *   - 密钥有效 → 正常返回（哪怕该 sku 查不到，也说明签名与权限没问题）
 *   - 密钥无效 / 权限未开 → 网关会回带 code + message，直接抛出真实原因
 * 之所以不复用 queryProduct：后者失败会降级成 Mock，会把真实错误吞掉。
 *
 * @returns {Promise<void>} 失败时抛出带可行动文案的异常
 */
export async function probe() {
  if (!hasKeys()) throw new Error('未配置京东联盟密钥');

  const payload = await callGateway('jd.union.open.goods.query', {
    goodsReqDTO: { skuIds: ['100012043978'] },
  });
  // extractGoodsList 内部会把 403「无访问权限」等业务错误抛出来
  extractGoodsList(payload);
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
