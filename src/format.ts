import type { PlatformId } from './types';

/** 把「分」格式化成带 ¥ 的金额字符串。 */
export function formatYuan(cents: number, withSymbol = true): string {
  const value = Number.isFinite(cents) ? cents / 100 : 0;
  const text = value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return withSymbol ? `¥${text}` : text;
}

/** 把「分」格式化成整元（用于券面额、省了多少这类整数场景）。 */
export function formatYuanShort(cents: number): string {
  const value = Math.round((Number.isFinite(cents) ? cents : 0) / 100);
  return `¥${value.toLocaleString('zh-CN')}`;
}

/** 平台对应的主题色（用于徽章、图表、按钮）。 */
export const PLATFORM_THEME: Record<PlatformId, { name: string; color: string; soft: string }> = {
  jd: { name: '京东', color: '#E1251B', soft: 'bg-red-50 text-red-700 border-red-200' },
  taobao: { name: '淘宝 / 天猫', color: '#FF5000', soft: 'bg-orange-50 text-orange-700 border-orange-200' },
  pdd: { name: '拼多多', color: '#E22E1F', soft: 'bg-rose-50 text-rose-700 border-rose-200' },
};

/** 取平台展示名（后端已带 platformName，这里只做兜底）。 */
export function platformName(platformId: PlatformId): string {
  return PLATFORM_THEME[platformId]?.name ?? platformId;
}

/** 平台徽章配色。 */
export function platformBadgeClass(platformId: PlatformId): string {
  return PLATFORM_THEME[platformId]?.soft ?? 'bg-slate-100 text-slate-700 border-slate-200';
}

/** 把 2026-09-08 转成 09-08。 */
export function shortDate(date: string): string {
  return String(date ?? '').slice(5);
}

/** 券面额文案：满 3000 减 150 / 无门槛减 20。 */
export function couponRuleText(threshold: number, amount: number): string {
  if (threshold > 0) {
    return `满 ${formatYuanShort(threshold).slice(1)} 减 ${formatYuanShort(amount).slice(1)}`;
  }
  return `无门槛减 ${formatYuanShort(amount).slice(1)}`;
}
