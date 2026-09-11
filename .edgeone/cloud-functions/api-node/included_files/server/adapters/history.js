import { httpJson } from '../utils/http.js';
import { toCents } from '../utils/quote.js';
import { buildMockHistory, finalizeHistory } from './mock.js';
import * as priceStore from '../utils/priceStore.js';
import * as dataoke from './dataoke.js';

/**
 * 历史价格聚合 Adapter。
 *
 * **关键事实**：京东联盟 / 淘宝客 / 多多进宝等 CPS 联盟 API 均**不含历史价格**，
 * 历史价必须独立接源。
 *
 * 数据源优先级（先命中先返回）：
 *   1. local      —— 自建本地价格库（真实观测，最可信）
 *   2. dataoke    —— 大淘客开放平台（仅淘宝 / 天猫）
 *   3. thirdparty —— 通用第三方历史价接口（HISTORY_API_BASE_URL，慢慢买类）
 *   4. simulated  —— 无真实数据时的兜底
 *
 * 默认兜底返回**空序列**（source: 'simulated' + points: []），前端据此展示空态，
 * 绝不画假曲线误导购买决策。如需演示假曲线，设 HISTORY_SIMULATE_ON_EMPTY=true。
 */

/** 数据来源标识。 */
export const SOURCE_LOCAL = 'local';
export const SOURCE_DATAOKE = 'dataoke';
export const SOURCE_THIRDPARTY = 'thirdparty';
export const SOURCE_SIMULATED = 'simulated';

/** 空态文案（前后端共用一份，前端也有兜底）。 */
export const EMPTY_HISTORY_MESSAGE =
  '暂无历史数据，每次查询会自动记录，累积几天后即可看到真实价格曲线';

const DATE_KEYS = ['date', 'day', 'dt', 'time', 'timestamp', 'createTime', 'priceDate', 'dateTime'];
const PRICE_KEYS = ['price', 'prc', 'amount', 'value', 'currentPrice', 'priceValue', 'p'];

/**
 * @returns {boolean} 是否已配置通用第三方历史价接口
 */
export function hasKeys() {
  return Boolean(process.env.HISTORY_API_BASE_URL && process.env.HISTORY_API_KEY);
}

/**
 * 是否允许在无真实数据时生成模拟曲线（默认关闭）。
 * @returns {boolean}
 */
function isSimulateOnEmpty() {
  return String(process.env.HISTORY_SIMULATE_ON_EMPTY ?? 'false').trim().toLowerCase() === 'true';
}

/**
 * 判断一个字段键名是否像日期。
 * @param {string} key
 * @returns {boolean}
 */
function isDateKey(key) {
  const lower = String(key).toLowerCase();
  return DATE_KEYS.some((candidate) => lower.includes(candidate.toLowerCase()));
}

/**
 * 判断一个字段键名是否像价格。
 * @param {string} key
 * @returns {boolean}
 */
function isPriceKey(key) {
  const lower = String(key).toLowerCase();
  return PRICE_KEYS.some(
    (candidate) => lower === candidate.toLowerCase() || lower.endsWith(candidate.toLowerCase()),
  );
}

/**
 * 判断数组是否像「历史价格点」数组（能同时匹配上大淘客的 historicalPrice 等形态）。
 * @param {unknown} value
 * @returns {value is any[]}
 */
function looksLikePoints(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const first = value[0];
  if (!first || typeof first !== 'object') return false;
  const keys = Object.keys(first);
  return keys.some(isDateKey) && keys.some(isPriceKey);
}

/**
 * 在任意嵌套的响应体里找出第一个「历史价格点」数组。
 * @param {unknown} node
 * @param {number} [depth]
 * @returns {any[]|null}
 */
function findPointsArray(node, depth = 0) {
  if (depth > 5 || node === null || node === undefined) return null;
  if (looksLikePoints(node)) return node;

  if (typeof node === 'object') {
    for (const value of Object.values(/** @type {Record<string, unknown>} */ (node))) {
      const found = findPointsArray(value, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

/**
 * 把第三方响应体映射成统一的 HistoryData。
 * @param {any} payload
 * @param {number} currentPrice 当前价（分）
 * @returns {object|null} 解析失败返回 null
 */
export function normalizeHistoryPayload(payload, currentPrice) {
  const raw = findPointsArray(payload);
  if (!raw) return null;

  const unit = (process.env.HISTORY_PRICE_UNIT ?? 'yuan').toLowerCase();

  const points = raw
    .map((item) => {
      const dateKey = Object.keys(item).find(isDateKey);
      const priceKey = Object.keys(item).find(isPriceKey);
      if (!dateKey || !priceKey) return null;

      const rawDate = item[dateKey];
      const date =
        typeof rawDate === 'number'
          ? new Date(rawDate > 1e12 ? rawDate : rawDate * 1000).toISOString().slice(0, 10)
          : String(rawDate).slice(0, 10);

      const rawPrice = item[priceKey];
      const price = unit === 'cent' ? Math.round(Number(rawPrice) || 0) : toCents(rawPrice);

      if (!date || price <= 0) return null;
      return { date, price };
    })
    .filter(Boolean);

  if (points.length < 2) return null;

  return finalizeHistory({
    points,
    current: currentPrice,
    isMock: false,
    rangeDays: new Set(points.map((point) => point.date)).size,
  });
}

/**
 * 构造「无真实历史数据」的空结果。
 * @param {number} currentPrice
 * @param {Error|null} [reason] 配置了数据源但调用失败时给出原因
 * @returns {object}
 */
function emptyHistory(currentPrice, reason = null) {
  return {
    isMock: true,
    source: SOURCE_SIMULATED,
    rangeDays: 0,
    points: [],
    current: Math.max(0, Math.round(currentPrice || 0)),
    max: 0,
    min: 0,
    avg: 0,
    maxDate: '',
    minDate: '',
    percentile: 0,
    changeFromMax: 0,
    changeFromAvg: 0,
    recordedDays: 0,
    insights: [],
    message: EMPTY_HISTORY_MESSAGE,
    ...(reason ? { warning: `历史价数据源暂不可用：${reason.message}` } : {}),
  };
}

/**
 * 查询历史价格。按 本地库 → 大淘客 → 通用第三方 → 兜底 的顺序取第一个可用数据源。
 *
 * @param {object} options
 * @param {string} [options.url]
 * @param {string} [options.itemId]
 * @param {string} [options.platformId]
 * @param {string} [options.title]
 * @param {number} [options.currentPrice] 当前价（分），用于计算百分位
 * @param {string} [options.keyword]
 * @returns {Promise<object>} HistoryData（含 source 与 recordedDays）
 */
export async function queryHistory(options = {}) {
  const {
    url = '',
    itemId = '',
    platformId = '',
    title = '',
    currentPrice = 0,
    keyword = '',
  } = options;

  // ① 自建本地价格库：真实观测数据，最可信，优先使用
  if (priceStore.isEnabled() && platformId && itemId) {
    try {
      const points = await priceStore.getSeries(platformId, itemId);
      if (points.length >= 2) {
        const recordedDays = new Set(points.map((point) => point.date)).size;
        const current = currentPrice > 0 ? currentPrice : points[points.length - 1].price;
        return {
          ...finalizeHistory({ points, current, isMock: false, rangeDays: recordedDays }),
          source: SOURCE_LOCAL,
          recordedDays,
        };
      }
    } catch {
      // 本地库读写异常不应阻断主流程，继续尝试其它数据源
    }
  }

  /** @type {Error|null} 最后一个数据源的失败原因，用于兜底时提示 */
  let lastError = null;

  // ② 大淘客开放平台（仅淘宝 / 天猫商品）
  if (dataoke.hasKeys() && dataoke.supports(platformId) && itemId) {
    try {
      const payload = await dataoke.fetchPriceTrend({ itemId });
      const normalized = normalizeHistoryPayload(payload, currentPrice);
      if (normalized) {
        return { ...normalized, source: SOURCE_DATAOKE, recordedDays: normalized.points.length };
      }
      lastError = new Error('大淘客返回结构无法解析');
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // ③ 通用第三方历史价接口（HISTORY_API_BASE_URL）
  if (hasKeys()) {
    try {
      const payload = await httpJson(process.env.HISTORY_API_BASE_URL ?? '', {
        method: 'POST',
        json: {
          key: process.env.HISTORY_API_KEY ?? '',
          url,
          itemId,
          platform: platformId,
          title,
          keyword,
        },
        timeout: 8000,
      });

      const normalized = normalizeHistoryPayload(payload, currentPrice);
      if (normalized) {
        return {
          ...normalized,
          source: SOURCE_THIRDPARTY,
          recordedDays: normalized.points.length,
        };
      }
      lastError = new Error('第三方历史价接口返回结构无法解析');
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  // ④ 兜底：默认返回空态（不画假曲线）；显式开启时才生成模拟曲线
  if (isSimulateOnEmpty()) {
    const seed = itemId || url || keyword || title || 'default';
    const mock = buildMockHistory({ seed, currentPrice, keyword, title });
    return { ...mock, source: SOURCE_SIMULATED, recordedDays: 0 };
  }

  return emptyHistory(currentPrice, lastError);
}

export default { queryHistory, hasKeys, normalizeHistoryPayload };
