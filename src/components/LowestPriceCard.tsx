import React from 'react';
import type { LowestResult } from '../types';
import { formatYuan, formatYuanShort, platformBadgeClass } from '../format';

interface LowestPriceCardProps {
  lowest: LowestResult;
  isMock: boolean;
  /** 参与比价的平台数量 */
  platformCount: number;
}

/**
 * 全网最低价结论卡：突出平台、券后价、省了多少。
 * 涨跌配色遵循中国习惯：省钱 / 降价 = 红，更贵 = 绿。
 */
const LowestPriceCard: React.FC<LowestPriceCardProps> = ({ lowest, isMock, platformCount }) => {
  const hasCoupon = lowest.couponTotal > 0;
  const hasSaving = lowest.saveAmount > 0;

  return (
    <section className="animate-fade-up overflow-hidden rounded-xl2 border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-white p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-3 py-1 text-xs font-bold text-white">
              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                <path d="M10 2.5l2.3 4.9 5.2.7-3.8 3.6.9 5.3-4.6-2.5-4.6 2.5.9-5.3L2.5 8.1l5.2-.7L10 2.5z" />
              </svg>
              全网最低价
            </span>
            <span className={`chip ${platformBadgeClass(lowest.platformId)}`}>{lowest.platformName}</span>
            {isMock ? (
              <span className="chip border-amber-300 bg-amber-100 text-amber-800">演示数据</span>
            ) : null}
          </div>

          <p className="mt-3 line-clamp-2 text-[15px] font-medium text-slate-800">{lowest.title}</p>

          <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
            <span className="tnum text-4xl font-extrabold leading-none text-brand-600 sm:text-[42px]">
              {formatYuan(lowest.finalPrice)}
            </span>
            {hasCoupon ? (
              <span className="tnum pb-1 text-sm text-slate-400 line-through">
                {formatYuan(lowest.price)}
              </span>
            ) : null}
            {hasCoupon ? (
              <span className="chip border-red-200 bg-red-50 pb-1 text-red-600">
                已优惠 {formatYuanShort(lowest.couponTotal)}
              </span>
            ) : null}
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-slate-600">
            共比价 <span className="tnum font-semibold text-slate-800">{platformCount}</span> 个平台
            {hasSaving ? (
              <>
                ，比最高的 {lowest.comparedWith} 便宜{' '}
                <span className="tnum font-semibold text-red-600">{formatYuan(lowest.saveAmount)}</span>
                <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600">
                  省 {lowest.savePercent}%
                </span>
              </>
            ) : (
              '，该商品在各平台价格一致'
            )}
          </p>
        </div>

        <div className="shrink-0">
          <a
            href={lowest.url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full shadow-pop lg:w-auto"
          >
            去 {lowest.platformName} 购买
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M7.5 4.5 13 10l-5.5 5.5-1.4-1.4 4.1-4.1-4.1-4.1 1.4-1.4Z" />
            </svg>
          </a>
          <p className="mt-2 text-center text-[11px] text-slate-400">将跳转到官方商品页</p>
        </div>
      </div>
    </section>
  );
};

export default LowestPriceCard;
