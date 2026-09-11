import jd from './jd.js';
import taobao from './taobao.js';
import pdd from './pdd.js';

/**
 * Adapter 注册表：新增平台只需实现统一契约后在此登记，路由层无需改动。
 */

/** @type {Array<{platformId: string, platformName: string, parseUrl: Function, queryProduct: Function, searchByKeyword: Function, hasKeys: Function}>} */
const ADAPTERS = [jd, taobao, pdd];

/**
 * 按平台 ID 取 Adapter。
 * @param {string} platformId
 * @returns {any|null}
 */
export function getAdapter(platformId) {
  return ADAPTERS.find((adapter) => adapter.platformId === platformId) ?? null;
}

/**
 * 列出全部 Adapter。
 * @returns {any[]}
 */
export function listAdapters() {
  return [...ADAPTERS];
}

/**
 * 列出除指定平台外的其它 Adapter。
 * @param {string} excludePlatformId
 * @returns {any[]}
 */
export function otherAdapters(excludePlatformId) {
  return ADAPTERS.filter((adapter) => adapter.platformId !== excludePlatformId);
}

/**
 * 平台显示名映射。
 * @param {string} platformId
 * @returns {string}
 */
export function platformName(platformId) {
  return getAdapter(platformId)?.platformName ?? platformId;
}

export default { getAdapter, listAdapters, otherAdapters, platformName };
