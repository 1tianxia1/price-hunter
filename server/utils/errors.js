/**
 * 统一错误类型：携带 HTTP 状态码与可直接展示给用户的中文文案。
 */

export class ApiError extends Error {
  /**
   * @param {number} status HTTP 状态码
   * @param {string} message 可直接展示的中文提示
   * @param {object|null} [details] 可选的调试信息（不会展示给终端用户）
   */
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

/**
 * 是否为 ApiError 实例。
 * @param {unknown} err
 * @returns {err is ApiError}
 */
export function isApiError(err) {
  return err instanceof ApiError;
}

/**
 * 把任意异常转成 ApiError，避免未知异常把内部堆栈直接抛给前端。
 * @param {unknown} err
 * @param {number} [fallbackStatus]
 * @returns {ApiError}
 */
export function toApiError(err, fallbackStatus = 500) {
  if (err instanceof ApiError) return err;
  const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : String(err);
  return new ApiError(fallbackStatus, `服务内部错误：${message || '未知异常'}`);
}

/**
 * 构造联盟网关业务层错误的统一异常。
 *
 * 三家网关的「签名正确但权限/参数有问题」都会以业务码返回：
 *   - 京东联盟：result 里 { code: 403, message: '无访问权限' }
 *   - 淘宝 Top：{ error_response: { code, msg, sub_msg } }
 *   - 多多进宝：{ error_response: { error_code, error_msg } }
 *
 * 403 / 权限类错误额外给出「去后台开通接口权限」的行动指引——
 * 这类问题代码侧无法解决，必须让用户一眼看到该做什么。
 *
 * @param {string} platformName 平台中文名（京东联盟 / 淘宝客 / 多多进宝）
 * @param {string|number} code 业务错误码
 * @param {string} message 平台返回的错误描述
 * @returns {Error}
 */
export function upstreamError(platformName, code, message) {
  const text = String(message ?? '未知错误');
  const isPermission = Number(code) === 403 || /权限|permission|forbidden/i.test(text);
  const tip = isPermission
    ? `。这是账号权限问题而非代码问题：请登录${platformName}开放平台后台，在「API 权限 / 接口权限」处申请开通对应接口，审核通过后无需改代码即可生效`
    : '';
  return new Error(`${platformName}接口返回业务错误（${code}）：${text}${tip}`);
}
