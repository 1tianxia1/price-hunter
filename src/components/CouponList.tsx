import React from 'react';
import type { Coupon, ProductQuote } from '../types';
import { couponRuleText, formatYuan, formatYuanShort, platformBadgeClass } from '../format';

interface CouponListProps {
  /** 当前选中平台对应的报价；为 null 时展示全部平台的券 */
  quotes: ProductQuote[];
  /** 选中的平台，'all' 表示全部 */
  activePlatform: string;
}

/**
 * 可用优惠券列表。券后价基于「最优券」计算，这里把最优券明确标注出来。
 *
 * 领券动作分两级：
 *   1. 券自带 couponUrl（联盟真实返回）→ 显示「立即领券」，直接跳领取页；
 *   2. 拿不到券链接（演示数据 / 权限不足）→ 只显示「去商品页领券」，
 *      绝不伪造一个领不到的链接，避免用户点了空欢喜。
 */
const CouponList: React.FC<CouponListProps> = ({ quotes, activePlatform }) => {
  const visibleQuotes = activePlatform === 'all' ? quotes : quotes.filter((q) => q.platformId === activePlatform);

  const items: Array<{ quote: ProductQuote; coupon: Coupon }> = [];
  for (const quote of visibleQuotes) {
    for (const coupon of quote.coupons) {
      items.push({ quote, coupon });
    }
  }

  if (items.length === 0) {
    return (
      <section className="card">
        <h3 className="card-title mb-3">
          <span className="h-4 w-1 rounded-full bg-brand-500" />
          可用优惠券
        </h3>
        <p className="py-6 text-center text-sm text-slate-400">该平台暂未查询到可用优惠券</p>
      </section>
    );
  }

  const claimableCount = items.filter(({ coupon }) => coupon.couponUrl).length;

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="card-title">
          <span className="h-4 w-1 rounded-full bg-brand-500" />
          可用优惠券
        </h3>
        <span className="text-[13px] text-slate-400">
          共 {items.length} 张
          {claimableCount > 0 ? ` · ${claimableCount} 张可直接领取` : ''}
        </span>
      </div>

      <ul className="space-y-3">
        {items.map(({ quote, coupon }) => {
          const hasLink = Boolean(coupon.couponUrl);
          const couponFinal = Math.max(0, quote.price - coupon.amount);

          return (
            <li
              key={`${quote.platformId}-${coupon.id}`}
              className={`flex items-center gap-4 overflow-hidden rounded-xl border p-4 ${
                coupon.best ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'
              }`}
            >
              {/* 券面额 */}
              <div className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 text-white">
                <span className="tnum text-xl font-extrabold leading-none">
                  {formatYuanShort(coupon.amount).slice(1)}
                </span>
                <span className="mt-1 text-[11px] opacity-90">
                  {coupon.threshold > 0 ? `满${Math.round(coupon.threshold / 100)}可用` : '无门槛'}
                </span>
              </div>

              {/* 券信息 */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{coupon.name}</span>
                  {coupon.best ? (
                    <span className="chip border-red-300 bg-red-500 text-white">已计入券后价</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[13px] text-slate-500">
                  <span className={`chip mr-1.5 ${platformBadgeClass(quote.platformId)}`}>{quote.platformName}</span>
                  {couponRuleText(coupon.threshold, coupon.amount)}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {coupon.expireText || '有效期以商品页为准'}
                  {quote.price > 0 ? ` · 券后约 ${formatYuan(couponFinal)}` : ''}
                </p>
              </div>

              {/* 领券动作 */}
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {hasLink ? (
                  <a
                    href={coupon.couponUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-brand-500 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-600"
                  >
                    立即领券
                  </a>
                ) : quote.url ? (
                  <a
                    href={quote.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-slate-300 px-3.5 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-slate-50"
                  >
                    去商品页领券
                  </a>
                ) : null}
                {!hasLink ? (
                  <span className="text-[10px] leading-tight text-slate-400">
                    未返回券链接
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {/* 演示数据下必须说清楚：券是编的，领不到 */}
      {items.every(({ quote }) => quote.isMock) ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">
          当前为演示数据，券面额与名称均为示例，<strong>点击跳转也无法真实领取</strong>。
          配置联盟密钥后此处会显示真实可领的优惠券与领取链接。
        </p>
      ) : null}
    </section>
  );
};

export default CouponList;
