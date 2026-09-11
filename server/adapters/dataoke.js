import { httpJson } from '../utils/http.js';
import { signDataoke } from '../utils/sign.js';

/**
 * 大淘客开放平台 Adapter（历史价格数据源之一）。
 *
 * 选型原因：原计划的「慢慢买」没有公开自助注册入口（只有 MCP 测试 token 与企业商务合作），
 * 无法自助接入；大淘客开放平台 `openapi.dataoke.com` 提供 `/api/goods/price-trend`
 * 商品历史券后价接口，官方标注免费自助接入。
 *
 * 签名规则：参数按 key 升序拼 `key1=value1&key2=value2`，首尾包 appSecret，MD5 大写。
 *
 * 覆盖范围：大淘客只认识淘宝 / 天猫商品，因此仅在 platformId === 'taobao' 时调用，
 * 京东 / 拼多多会直接跳过，交给后面的数据源。
 */

const BASE_URL = 'https://openapi.dataoke.com';
const PRICE_TREND_PATH = '/api/goods/price-trend';
const DEFAULT_VERSION = 'v1.0.0';

/** @returns {boolean} 是否已配置大淘客密钥 */
export function hasKeys() {
  return Boolean(process.env.DATAOKE_APP_KEY && process.env.DATAOKE_APP_SECRET);
}

/**
 * 该平台商品能否用大淘客查历史价（只支持淘宝 / 天猫）。
 * @param {string} platformId
 * @returns {boolean}
 */
export function supports(platformId) {
  return platformId === 'taobao';
}

/**
 * 查询商品历史券后价趋势。
 *
 * ⚠️ 官方文档明确：`id`（大淘客在线商品 id）是**必填**，`goodsId`（淘宝商品 id）为**可选**。
 * 我们手里只有淘宝商品 id，因此两个字段都带上——大淘客会在服务端按 goodsId 反查 id。
 * 只传 goodsId 会因缺 `id` 报「参数错误」，这是早期版本的实际故障点。
 *
 * @param {object} options
 * @param {string} options.itemId 淘宝 / 天猫商品 ID（num_iid，即官方的 goodsId）
 * @returns {Promise<any>} 上游原始响应，由 history.js 统一做字段映射
 */
export async function fetchPriceTrend(options) {
  const { itemId } = options;

  if (!hasKeys()) {
    throw new Error('未配置 DATAOKE_APP_KEY / DATAOKE_APP_SECRET');
  }
  if (!itemId) {
    throw new Error('缺少商品 ID，大淘客无法查询');
  }

  const appKey = process.env.DATAOKE_APP_KEY ?? '';
  const appSecret = process.env.DATAOKE_APP_SECRET ?? '';

  const params = {
    appKey,
    version: process.env.DATAOKE_VERSION ?? DEFAULT_VERSION,
    // 已知的淘宝商品 id 同时充当大淘客商品 id 的查询入口
    id: String(itemId),
    goodsId: String(itemId),
  };
  params.sign = signDataoke(params, appSecret);

  const payload = await httpJson(`${BASE_URL}${PRICE_TREND_PATH}`, {
    method: 'GET',
    query: params,
    timeout: 8000,
  });

  // 大淘客用 code: "1" 表示成功，其余为业务错误。必须抛出去，
  // 否则会被 history.js 当成「返回结构无法解析」而掩盖真实原因。
  const code = String(payload?.code ?? '');
  if (code && code !== '1') {
    throw new Error(payload?.msg ?? `大淘客接口返回错误码 ${code}`);
  }

  return payload;
}

export default { hasKeys, supports, fetchPriceTrend };
