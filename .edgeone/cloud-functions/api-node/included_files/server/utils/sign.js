import crypto from 'node:crypto';

/**
 * 联盟 API 签名工具。
 *
 * 三家平台的签名算法主体一致（差异在参数名与时间戳格式），均遵循：
 *   1. 除 sign 外所有参数按参数名 ASCII 升序排列；
 *   2. 依次拼接成 `key1value1key2value2...`（无分隔符）；
 *   3. 在拼接串首尾各包一层密钥（secret）；
 *   4. MD5 后转大写。
 *
 * 之所以按平台拆成三个具名函数而不是共用一个，是为了后续某家平台调整规则时
 * 只改对应函数，不牵连其它平台。
 */

/**
 * MD5 摘要并转大写。
 * @param {string} input
 * @returns {string}
 */
export function md5Upper(input) {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex').toUpperCase();
}

/**
 * 把参数值转成参与签名的字符串。
 * @param {unknown} value
 * @returns {string}
 */
function stringifyValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * 过滤空值并按参数名升序返回 [key, value] 列表。
 * @param {Record<string, unknown>} params
 * @returns {Array<[string, string]>}
 */
export function sortParams(params) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => /** @type {[string, string]} */ ([key, stringifyValue(value)]))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * 按 `key1value1key2value2...` 拼接排序后的参数。
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function concatSortedParams(params) {
  return sortParams(params)
    .map(([key, value]) => `${key}${value}`)
    .join('');
}

/**
 * 按 `key1=value1&key2=value2...` 拼接排序后的参数（大淘客用这种格式）。
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
export function concatKeyValueParams(params) {
  return sortParams(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

/**
 * 通用「密钥前后包裹 + MD5 大写」签名。
 * @param {Record<string, unknown>} params
 * @param {string} secret
 * @returns {string}
 */
export function signWithSecretWrap(params, secret) {
  const raw = `${secret}${concatSortedParams(params)}${secret}`;
  return md5Upper(raw);
}

/**
 * 大淘客开放平台签名：
 * 参数按 key 升序拼成 `key1=value1&key2=value2`，首尾包 appSecret，MD5 转大写。
 * 注意与淘宝客的 `key1value1key2value2` 不同，大淘客带 `=` 和 `&`。
 *
 * @param {Record<string, unknown>} params
 * @param {string} appSecret
 * @returns {string}
 */
export function signDataoke(params, appSecret) {
  return md5Upper(`${appSecret}${concatKeyValueParams(params)}${appSecret}`);
}

/**
 * 京东联盟签名：参数按 key 升序拼接 + appSecret 前后包裹 + MD5 大写。
 * @param {Record<string, unknown>} params
 * @param {string} appSecret
 * @returns {string}
 */
export function signJdUnion(params, appSecret) {
  return signWithSecretWrap(params, appSecret);
}

/**
 * 阿里妈妈淘宝客 Top 协议签名（sign_method=md5）。
 * @param {Record<string, unknown>} params
 * @param {string} appSecret
 * @returns {string}
 */
export function signTaobaoTop(params, appSecret) {
  return signWithSecretWrap(params, appSecret);
}

/**
 * 多多进宝签名：clientId / clientSecret / timestamp（秒）排序拼接 + MD5 大写。
 * @param {Record<string, unknown>} params
 * @param {string} clientSecret
 * @returns {string}
 */
export function signPddDdk(params, clientSecret) {
  return signWithSecretWrap(params, clientSecret);
}

/**
 * 在当前参数基础上追加 sign 字段并返回新对象（不修改入参）。
 * @param {Record<string, unknown>} params
 * @param {string} secret
 * @returns {Record<string, unknown>}
 */
export function withSign(params, secret) {
  return { ...params, sign: signWithSecretWrap(params, secret) };
}

/**
 * 京东联盟 / 淘宝客要求的时间戳格式：YYYY-MM-DD HH:mm:ss。
 * @param {Date} [date]
 * @returns {string}
 */
export function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * 多多进宝要求的秒级时间戳。
 * @param {Date} [date]
 * @returns {number}
 */
export function unixSeconds(date = new Date()) {
  return Math.floor(date.getTime() / 1000);
}
