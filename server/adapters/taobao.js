import { buildQuote, toCents } from '../utils/quote.js';
import { httpJson } from '../utils/http.js';
import { signTaobaoTop, formatTimestamp } from '../utils/sign.js';
import { extractItemId, buildSearchUrl } from '../utils/urlParser.js';
import { pickMostSimilar } from '../utils/text.js';
import { upstreamError } from '../utils/errors.js';
import { buildMockQuote } from './mock.js';

/**
 * 阿里妈妈淘宝客 Adapter（覆盖淘宝 / 天猫）。
 *
 * Top 协议签名（sign_method=md5）：
 *   1. 除 sign 外参数按参数名 ASCII 升序排列；
 *   2. 拼接成 `key1value1key2value2...`；
 *   3. 首尾各包一层 appSecret；
 *   4. MD5 后转大写。
 *
 * 说明：淘宝客不使用「转链」能力（本期明确不做 CPS 返利转链），
 * 因此优惠券走 `taobao.tbk.coupon.get` 的可选查询，失败时券列表为空但不影响比价。
 */

const PLATFORM_ID = 'taobao';
const PLATFORM_NAME = '淘宝 / 天猫';
const GATEWAY_URL = 'https://gw.api.taobao.com/router/rest';

/**
 * 读取淘宝客 AppKey。
 * 主用 TB_APP_KEY（与 PM 教程一致），兼容旧命名 TAOBAO_APP_KEY。
 * @returns {string}
 */
function appKey() {
  return process.env.TB_APP_KEY || process.env.TAOBAO_APP_KEY || '';
}

/**
 * 读取淘宝客 AppSecret。
 * 主用 TB_APP_SECRET，兼容旧命名 TAOBAO_APP_SECRET。
 * @returns {string}
 */
function appSecret() {
  return process.env.TB_APP_SECRET || process.env.TAOBAO_APP_SECRET || '';
}

/** @returns {boolean} 是否已配置淘宝客密钥 */
function hasKeys() {
  return Boolean(appKey() && appSecret());
}

/**
 * 从链接提取淘宝 / 天猫商品 ID（num_iid）。
 * @param {string} url
 * @returns {string|null}
 */
export function parseUrl(url) {
  return extractItemId(PLATFORM_ID, url);
}

/**
 * 调用淘宝客 Top 网关。
 * @param {string} method API 方法名
 * @param {Record<string, unknown>} bizParams 业务参数
 * @returns {Promise<any>}
 */
async function callGateway(method, bizParams) {
  const params = {
    method,
    app_key: appKey(),
    format: 'json',
    v: '2.0',
    sign_method: 'md5',
    timestamp: formatTimestamp(),
    ...bizParams,
  };
  params.sign = signTaobaoTop(params, appSecret());

  return httpJson(GATEWAY_URL, { method: 'POST', form: params, timeout: 8000 });
}

/**
 * 取出 `xxx_response.results.n_tbk_item` 形态的商品数组。
 * @param {any} payload
 * @param {string} responseKey
 * @returns {any[]}
 */
function extractItemList(payload, responseKey) {
  assertNoTopError(payload);

  const response = payload?.[responseKey] ?? payload ?? {};
  const list = response?.results?.n_tbk_item;
  if (Array.isArray(list)) return list;
  return list ? [list] : [];
}

/**
 * 淘宝 Top 业务错误统一检查：{ error_response: { code, msg, sub_msg } }。
 * 权限不足 / 参数错误必须抛出去让用户看到，不能当成「没有商品」。
 * @param {any} payload
 * @returns {void}
 */
function assertNoTopError(payload) {
  const errResp = payload?.error_response;
  if (errResp) {
    throw upstreamError(
      '淘宝客',
      errResp.code ?? errResp.sub_code ?? 'UNKNOWN',
      errResp.sub_msg ?? errResp.msg ?? '未知错误',
    );
  }
}

/**
 * 从推广位 PID（mm_1_2_3 形态）里提取 adzone_id（第三段数字）。
 * @returns {string} 提取不到返回空串
 */
function adzoneId() {
  const pid = process.env.TAOBAO_PID ?? '';
  const parts = pid.split('_').filter(Boolean);
  return parts.length >= 3 && /^\d+$/.test(parts[parts.length - 1])
    ? parts[parts.length - 1]
    : '';
}

/**
 * 物料搜索接口的商品数组提取。
 * 主结构：taobao.tbk.dg.material.optional.upgrade（16516 物料搜索权限包对应的现行接口）
 *   → tbk_dg_material_optional_upgrade_response.result_list.map_data
 * 兼容旧结构：tbk_dg_material_optional_response 与 results.n_tbk_item
 * @param {any} payload
 * @returns {any[]}
 */
function extractMaterialItems(payload) {
  assertNoTopError(payload);
  for (const rootKey of [
    'tbk_dg_material_optional_upgrade_response',
    'tbk_dg_material_optional_response',
  ]) {
    const mapData = payload?.[rootKey]?.result_list?.map_data;
    if (Array.isArray(mapData)) return mapData;
  }
  return extractItemList(payload, 'tbk_dg_material_optional_upgrade_response');
}

/**
 * 把淘宝客商品对象映射成统一中间结构。
 * 兼容两种形态：
 *   - 新版物料结构：{ item_basic_info, price_promotion_info, publish_info, item_id }
 *   - 旧结构：商品字段直接在 item 上（title / zk_final_price / num_iid ...）
 * @param {any} item
 * @returns {{title: string, shopName: string, imageUrl: string, price: number, coupons: object[], itemId: string, url: string}}
 */
function normalizeItem(item) {
  const info = item?.item_basic_info ?? item ?? {};
  const promo = item?.price_promotion_info ?? {};
  const publish = item?.publish_info ?? {};

  // 新版物料结构（optional.upgrade）的 item_basic_info 里没有任何价格字段，
  // 价格只存在于 price_promotion_info.final_promotion_price（已折算促销的到手价）。
  // 旧结构（item.info.get）价格在 zk_final_price / reserve_price。
  const price = toCents(
    info?.zk_final_price ?? info?.zkFinalPrice ?? info?.reserve_price ??
      promo?.final_promotion_price ?? 0,
  );

  /** @type {object[]} */
  const coupons = [];

  // 到手价：淘宝已把百亿补贴 / 消费券等促销折算进 final_promotion_price。
  // 旧结构下划线价（price）高于到手价 → 换算成一张「平台综合优惠」，保证券后价与官方到手价一致。
  // 新版结构下 price 本身就取自到手价 → 两者相等，不生成券（避免重复扣减）。
  const finalPromoPrice = toCents(promo?.final_promotion_price ?? 0);
  if (finalPromoPrice > 0 && price > finalPromoPrice) {
    const promoDesc =
      promo?.final_promotion_path_list?.final_promotion_path_map_data
        ?.map((p) => p?.promotion_title)
        .filter(Boolean)
        .slice(0, 2)
        .join('、') ?? '';
    coupons.push({
      name: promoDesc ? `平台优惠（${promoDesc}）` : '平台综合优惠',
      amount: price - finalPromoPrice,
      threshold: 0,
      expireText: '以商品页为准',
      source: info?.shop_title ?? PLATFORM_NAME,
    });
  }

  const clickUrl = String(publish?.click_url ?? '');
  return {
    title: info?.title ?? '',
    shopName: info?.shop_title ?? info?.shopTitle ?? '天猫店铺',
    imageUrl: info?.pict_url ?? info?.pictUrl ?? '',
    price,
    coupons,
    itemId: String(item?.item_id ?? info?.num_iid ?? info?.itemId ?? ''),
    // 推广链接是协议相对地址（//s.click.taobao.com/...），补全协议
    url: normalizeTaobaoUrl(clickUrl),
  };
}

/**
 * 可选地查询该商品的优惠券（需要额外的 TAOBAO_TBK_ME 授权参数）。
 * @param {string} itemId
 * @returns {Promise<object[]>}
 */
async function fetchCoupons(itemId) {
  const me = process.env.TAOBAO_TBK_ME ?? '';
  if (!me) return [];

  try {
    const payload = await callGateway('taobao.tbk.coupon.get', {
      item_id: String(itemId),
      me,
    });
    const response = payload?.tbk_coupon_get_response ?? payload ?? {};
    const raw = response?.data?.coupon_list ?? response?.data ?? [];
    const list = Array.isArray(raw) ? raw : [];

    return list
      .map((coupon, index) => ({
        id: `taobao-coupon-${index}`,
        name: coupon?.coupon_name ?? coupon?.name ?? '淘宝优惠券',
        amount: toCents(coupon?.coupon_amount ?? coupon?.amount ?? 0),
        threshold: toCents(coupon?.coupon_start_fee ?? coupon?.startFee ?? 0),
        expireText: coupon?.coupon_end_time ? `${String(coupon.coupon_end_time).slice(0, 10)} 前有效` : '以商品页为准',
        source: PLATFORM_NAME,
        // 券的领取链接：coupon_share_url 是领券页，coupon_click_url 是券后推广链接
        couponUrl: normalizeTaobaoUrl(
          coupon?.coupon_share_url ?? coupon?.couponShareUrl ??
            coupon?.coupon_click_url ?? coupon?.couponClickUrl ?? '',
        ),
      }))
      .filter((coupon) => coupon.amount > 0);
  } catch {
    // 券查询是可选增强，失败不阻塞主流程。
    return [];
  }
}

/**
 * 淘宝返回的推广链接是协议相对地址（//s.click.taobao.com/...），补全 https。
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTaobaoUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return `https:${raw}`;
  if (/^https?:\/\//i.test(raw)) return raw;
  return '';
}

/**
 * 查询商品报价。无 Key 或调用失败时降级为 Mock。
 * @param {string} itemId
 * @returns {Promise<object>} ProductQuote
 */
export async function queryProduct(itemId) {
  const detailUrl = `https://item.taobao.com/item.htm?id=${itemId}`;

  if (!hasKeys()) {
    return buildMockQuote({ platformId: PLATFORM_ID, itemId, url: detailUrl });
  }

  try {
    // 按商品 ID 精确查询必须走 taobao.tbk.item.info.get（商品详情接口）。
    // 该接口需要淘宝客「商品详情」权限；若账号仅有物料搜索权限会报无权限，
    // 此时会在下方 catch 里降级为演示数据并带上真实错误原因，方便用户对症申请权限。
    const payload = await callGateway('taobao.tbk.item.info.get', {
      num_iids: String(itemId),
      platform: '2',
      ip: '127.0.0.1',
    });
    const items = extractItemList(payload, 'tbk_item_info_get_response');
    const item = items[0];
    if (!item) {
      throw new Error('未查询到该商品，可能已下架或商品 ID 有误');
    }

    const normalized = normalizeItem(item);
    if (!normalized.price) {
      throw new Error('商品返回体缺少价格字段');
    }

    normalized.coupons = await fetchCoupons(itemId);

    return buildQuote({
      platformId: PLATFORM_ID,
      itemId: String(itemId),
      platformName: PLATFORM_NAME,
      title: normalized.title,
      shopName: normalized.shopName,
      imageUrl: normalized.imageUrl,
      price: normalized.price,
      coupons: normalized.coupons,
      url: item?.item_url ?? detailUrl,
      isMock: false,
    });
  } catch (err) {
    const fallback = buildMockQuote({ platformId: PLATFORM_ID, itemId, url: detailUrl });
    fallback.warning = `淘宝客接口调用失败，已降级为演示数据：${err?.message ?? '未知错误'}`;
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
    // taobao.tbk.item.get 与 taobao.tbk.dg.material.optional 均已下线（报「不合法ApiName」），
    // 现行接口为 taobao.tbk.dg.material.optional.upgrade（16516 物料搜索权限包），
    // 需要 adzone_id（推广位 PID 的第三段数字）
    const params = {
      q: String(keyword),
      page_no: '1',
      page_size: '10',
    };
    const adzone = adzoneId();
    if (adzone) params.adzone_id = adzone;

    const payload = await callGateway('taobao.tbk.dg.material.optional.upgrade', params);
    const items = extractMaterialItems(payload);
    if (items.length === 0) return null;

    const matched = pickMostSimilar(
      items.map((item) => ({
        raw: item,
        title: item?.item_basic_info?.title ?? item?.title ?? '',
      })),
      referenceTitle || keyword,
    );
    if (!matched) return null;

    const normalized = normalizeItem(matched.item.raw);
    if (!normalized.price) return null;

    return buildQuote({
      platformId: PLATFORM_ID,
      itemId: normalized.itemId,
      platformName: PLATFORM_NAME,
      title: normalized.title,
      shopName: normalized.shopName,
      imageUrl: normalized.imageUrl,
      price: normalized.price,
      coupons: normalized.coupons,
      url: normalized.url || buildSearchUrl(PLATFORM_ID, normalized.title),
      isMock: false,
      note: `按关键词匹配的同款商品（相似度 ${matched.score}）`,
    });
  } catch (err) {
    // 错误向上传递，由 compare 路由收进 warnings 展示给用户
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * 轻量探测：验证淘宝客密钥是否真的能调通。
 *
 * 用物料搜索接口（16516 权限包）做一次最小查询——它也是比价主流程依赖的接口，
 * 因此探测通过基本等价于「比价能用」。权限未开通时会回带 scope 错误，原样抛出。
 *
 * @returns {Promise<void>} 失败时抛出带可行动文案的异常
 */
export async function probe() {
  if (!hasKeys()) throw new Error('未配置淘宝客密钥');

  // 探测必须覆盖「按商品 ID 精确查详情」这条主链路（queryProduct 实际走的接口），
  // 而不是只测物料搜索——否则会出现「探测说能用、真粘贴链接却降级」的假阳性。
  const payload = await callGateway('taobao.tbk.item.info.get', {
    num_iids: '675167771090',
    platform: '2',
    ip: '127.0.0.1',
  });
  extractItemList(payload, 'tbk_item_info_get_response');
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
