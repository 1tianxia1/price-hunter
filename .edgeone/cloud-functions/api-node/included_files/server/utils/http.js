import { ApiError } from './errors.js';

/** 所有上游请求的统一超时时间（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 8000;

/**
 * 把混合类型的参数对象压平成字符串（数组 / 对象会序列化成 JSON）。
 * @param {Record<string, unknown>} form
 * @returns {Record<string, string>}
 */
function flattenForm(form) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * 检测上游网关返回体里的业务错误（淘宝 / 拼多多 / 京东都会在 200 里塞错误码）。
 * @param {unknown} payload
 * @returns {void}
 */
export function assertNoUpstreamError(payload) {
  if (!payload || typeof payload !== 'object') return;
  const data = /** @type {Record<string, any>} */ (payload);

  const taobaoError = data.error_response ?? data.errorResponse;
  if (taobaoError && typeof taobaoError === 'object') {
    const msg = taobaoError.sub_msg ?? taobaoError.msg ?? taobaoError.error_msg ?? '上游接口返回错误';
    throw new ApiError(502, `上游接口返回错误：${msg}`);
  }

  const jdError = data.error_response ?? data.errorResponse ?? data.error;
  if (typeof jdError === 'string' && jdError.trim()) {
    throw new ApiError(502, `上游接口返回错误：${jdError}`);
  }
}

/**
 * 发起一个 JSON HTTP 请求，带 8s 超时、统一错误包装。
 *
 * @param {string} url 完整 URL
 * @param {object} [options]
 * @param {'GET'|'POST'} [options.method]
 * @param {Record<string, string>} [options.headers]
 * @param {Record<string, unknown>|null} [options.query] 追加到 query string
 * @param {unknown|null} [options.json] 以 application/json 发送
 * @param {Record<string, unknown>|null} [options.form] 以 x-www-form-urlencoded 发送
 * @param {number} [options.timeout]
 * @returns {Promise<any>} 解析后的 JSON
 */
export async function httpJson(url, options = {}) {
  const {
    method = 'GET',
    headers = {},
    query = null,
    json = null,
    form = null,
    timeout = DEFAULT_TIMEOUT_MS,
  } = options;

  let target;
  try {
    target = new URL(url);
  } catch {
    throw new ApiError(500, `上游接口地址配置不合法：${url}`);
  }

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      target.searchParams.set(key, String(value));
    }
  }

  /** @type {RequestInit} */
  const init = {
    method,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PriceHunter/0.1 (+node-fetch)',
      ...headers,
    },
  };

  if (json !== null) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(json);
  } else if (form !== null) {
    init.headers = { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' };
    init.body = new URLSearchParams(flattenForm(form)).toString();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(target, { ...init, signal: controller.signal });
    const text = await response.text();

    if (!response.ok) {
      throw new ApiError(502, `上游接口返回异常状态 ${response.status}`);
    }

    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiError(502, '上游接口返回内容不是合法 JSON');
    }

    assertNoUpstreamError(payload);
    return payload;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err && typeof err === 'object' && err.name === 'AbortError') {
      throw new ApiError(504, `上游接口请求超时（${timeout / 1000}s）`);
    }
    const reason = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
    throw new ApiError(502, `上游接口请求失败：${reason}`);
  } finally {
    clearTimeout(timer);
  }
}
