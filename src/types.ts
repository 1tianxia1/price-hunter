/**
 * 前后端共享的类型定义。
 * 价格单位统一为「分」（整数），展示时 /100。
 */

export type PlatformId = 'jd' | 'taobao' | 'pdd';

export interface Coupon {
  id: string;
  name: string;
  /** 优惠金额（分） */
  amount: number;
  /** 使用门槛（分），0 表示无门槛 */
  threshold: number;
  expireText: string;
  source: string;
  /**
   * 券的真实领取链接（联盟转链返回）。
   * 空串 = 该券拿不到领取链接（演示数据 / 权限不足 / 平台未返回），
   * 前端此时不显示「立即领券」，只提供「去商品页领券」。
   */
  couponUrl: string;
  /** 是否为该商品最优券（券后价基于此券计算） */
  best: boolean;
}

export interface ProductQuote {
  platformId: PlatformId;
  /** 商品 ID，自建本地价格库按 (platformId, itemId) 归档 */
  itemId: string;
  platformName: string;
  title: string;
  shopName: string;
  imageUrl: string;
  /** 当前价（分） */
  price: number;
  coupons: Coupon[];
  /** 最优券金额（分） */
  couponTotal: number;
  /** 券后价（分） */
  finalPrice: number;
  url: string;
  isMock: boolean;
  note: string;
}

export interface LowestResult {
  platformId: PlatformId;
  platformName: string;
  title: string;
  /** 原价（分） */
  price: number;
  /** 券后价（分） */
  finalPrice: number;
  couponTotal: number;
  url: string;
  isMock: boolean;
  /** 相对全网最高券后价节省的金额（分） */
  saveAmount: number;
  /** 节省百分比，保留一位小数 */
  savePercent: number;
  comparedWith: string;
  comparedWithFinalPrice: number;
}

export interface HistoryPoint {
  date: string;
  /** 价格（分） */
  price: number;
}

/**
 * 历史价格数据来源：
 * - local      自建本地价格库（真实观测累积）
 * - dataoke    大淘客开放平台
 * - thirdparty 通用第三方历史价接口
 * - simulated  无真实数据时的兜底（默认返回空序列，前端展示空态）
 */
export type HistorySource = 'local' | 'dataoke' | 'thirdparty' | 'simulated';

export interface HistoryData {
  isMock: boolean;
  source: HistorySource;
  /** 本地库已记录的不同日期天数 */
  recordedDays: number;
  /** 空态等场景下的说明文案 */
  message?: string;
  rangeDays: number;
  points: HistoryPoint[];
  current: number;
  max: number;
  min: number;
  avg: number;
  maxDate: string;
  minDate: string;
  /** 当前价低于历史中百分之多少的时间 */
  percentile: number;
  changeFromMax: number;
  changeFromAvg: number;
  insights: string[];
}

export interface ParsedInput {
  url: string;
  platformId: PlatformId;
  platformName: string;
  itemId: string;
  keyword?: string;
}

export interface CompareResponse {
  input: ParsedInput;
  product: ProductQuote;
  quotes: ProductQuote[];
  lowest: LowestResult;
  history: HistoryData;
  isMock: boolean;
  warnings: string[];
  comparedAt: string;
}

export interface ParseResponse {
  url: string;
  platformId: PlatformId;
  platformName: string;
  itemId: string;
}

export interface HistoryResponse {
  history: HistoryData;
  warnings: string[];
  isMock: boolean;
  queriedAt: string;
}

export interface HealthResponse {
  service: string;
  time: string;
  configured: Record<string, boolean>;
}

/** 单个上游数据源的探测结果。 */
export interface ProbeResult {
  id: string;
  name: string;
  /** 密钥是否已配置 */
  configured: boolean;
  /** ok=可用 / no-key=没配 / network=连不上 / error=接口报错 */
  status: 'ok' | 'no-key' | 'network' | 'error';
  /** 失败时可直接展示给用户的原因 */
  message: string;
}

/** 整站数据模式，决定横幅文案。 */
export type DataMode = 'live' | 'partial' | 'no-key' | 'unreachable' | 'degraded';

export interface StatusResponse {
  time: string;
  keys: Record<string, boolean>;
  live: Record<string, ProbeResult>;
  history: {
    local: boolean;
    dataoke: boolean;
    thirdParty: boolean;
    hasRealSource: boolean;
  };
  mode: DataMode;
  anyMock: boolean;
}

export interface ApiFailure {
  code?: string;
  message: string;
}
