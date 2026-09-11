import type { CompareResponse, HistoryData, HistoryResponse, ParseResponse, StatusResponse } from './types';

/** API 基址：开发态走 Vite 代理 /api -> http://127.0.0.1:8787。 */
const API_BASE: string = (import.meta.env.VITE_API_BASE as string) || '/api';

/** 前端可直接展示的错误。 */
export class ApiRequestError extends Error {
  readonly code: string;

  constructor(message: string, code = 'UNKNOWN') {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

/**
 * 统一 POST JSON 请求封装，把后端 { success, error } 契约转成 Promise / ApiRequestError。
 * @param path 相对 API_BASE 的路径，如 '/compare'
 * @param body 请求体
 * @param signal 取消信号
 */
export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiRequestError('无法连接后端服务，请确认已执行 npm run dev 且 API 端口 8787 已启动', 'NETWORK');
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiRequestError('后端返回内容不是合法 JSON，请检查服务日志', 'PARSE');
  }

  const data = payload as { success?: boolean; error?: { code?: string; message?: string } } & Record<string, unknown>;

  if (!response.ok || data.success === false) {
    const message = data?.error?.message ?? `请求失败（HTTP ${response.status}）`;
    throw new ApiRequestError(message, data?.error?.code ?? `HTTP_${response.status}`);
  }

  return data as T;
}

/** 粘贴即识别：解析链接归属平台与商品 ID。 */
export function parseUrl(url: string, signal?: AbortSignal): Promise<ParseResponse> {
  return postJson<ParseResponse>('/parse', { url }, signal);
}

/** 主流程：跨平台比价 + 找券 + 历史价。 */
export function compare(url: string, signal?: AbortSignal): Promise<CompareResponse> {
  return postJson<CompareResponse>('/compare', { url }, signal);
}

/** 单独查询历史价格。 */
export function queryHistory(payload: { url?: string; keyword?: string }, signal?: AbortSignal): Promise<HistoryResponse> {
  return postJson<HistoryResponse>('/history', payload, signal);
}

/** 抽取出响应里的 HistoryData（兼容 /compare 与 /history 两种形态）。 */
export function extractHistory(data: CompareResponse | HistoryResponse): HistoryData | null {
  if ('history' in data && data.history) return data.history;
  return null;
}

/**
 * 查询数据源状态（密钥是否配置 + 实际能否调通）。
 * 这是「数据状态」面板的数据来源，用于区分
 * 「没配 Key」和「配了但接口调不通」两种完全不同的情况。
 */
export async function fetchStatus(signal?: AbortSignal): Promise<StatusResponse> {
  const response = await fetch(`${API_BASE}/status`, { signal });
  if (!response.ok) {
    throw new ApiRequestError(`状态接口返回异常（HTTP ${response.status}）`, `HTTP_${response.status}`);
  }
  return (await response.json()) as StatusResponse;
}
