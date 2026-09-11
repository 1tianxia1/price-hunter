import React from 'react';
import type { ProductQuote } from '../types';
import { couponRuleText, formatYuan, platformBadgeClass } from '../format';

interface PriceCompareTableProps {
  quotes: ProductQuote[];
  /** 最低价平台 ID，用于高亮 */
  lowestPlatformId: string;
}

/**
 * 各平台比价表：价格 / 券 / 券后价 / 去购买。
 * 桌面端为表格，移动端自动降级为卡片列表。
 */
const PriceCompareTable: React.FC<PriceCompareTableProps> = ({ quotes, lowestPlatformId }) => {
  if (quotes.length === 0) return null;

  const sorted = [...quotes].sort((a, b) => a.finalPrice - b.finalPrice);

  return (
    <section className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="card-title">
          <span className="h-4 w-1 rounded-full bg-brand-500" />
          各平台比价
        </h3>
        <span className="text-[13px] text-slate-400">按券后价由低到高排序</span>
      </div>

      {/* 桌面端：表格 */}
      <div className="hidden overflow-hidden rounded-xl border border-slate-200 md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[13px] text-slate-500">
              <th className="px-4 py-3 font-medium">平台 / 店铺</th>
              <th className="px-4 py-3 text-right font-medium">当前价</th>
              <th className="px-4 py-3 font-medium">可用券</th>
              <th className="px-4 py-3 text-right font-medium">券后价</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((quote) => {
              const isLowest = quote.platformId === lowestPlatformId;
              const bestCoupon = quote.coupons.find((coupon) => coupon.best) ?? null;

              return (
                <tr key={quote.platformId} className={isLowest ? 'bg-brand-50/60' : 'hover:bg-slate-50/60'}>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <img
                        src={quote.imageUrl}
                        alt={quote.platformName}
                        className="h-11 w-11 shrink-0 rounded-lg border border-slate-100 object-cover"
                        loading="lazy"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`chip ${platformBadgeClass(quote.platformId)}`}>
                            {quote.platformName}
                          </span>
                          {isLowest ? (
                            <span className="chip border-brand-300 bg-brand-500 text-white">最低</span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-[13px] text-slate-500" title={quote.shopName}>
                          {quote.shopName}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="tnum px-4 py-3.5 text-right text-slate-700">{formatYuan(quote.price)}</td>
                  <td className="px-4 py-3.5">
                    {bestCoupon ? (
                      <div className="flex flex-col gap-0.5">
                        <span className="chip border-red-200 bg-red-50 text-red-600">
                          {couponRuleText(bestCoupon.threshold, bestCoupon.amount)}
                        </span>
                        {quote.coupons.length > 1 ? (
                          <span className="text-[11px] text-slate-400">
                            共 {quote.coupons.length} 张可用券
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-[13px] text-slate-400">暂无可用券</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className={`tnum text-base font-bold ${isLowest ? 'text-brand-600' : 'text-slate-900'}`}>
                      {formatYuan(quote.finalPrice)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <a
                      href={quote.url || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700 transition-colors hover:border-brand-300 hover:text-brand-600"
                    >
                      去购买
                      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                        <path d="M7.5 4.5 13 10l-5.5 5.5-1.4-1.4 4.1-4.1-4.1-4.1 1.4-1.4Z" />
                      </svg>
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 移动端：卡片列表 */}
      <div className="space-y-3 md:hidden">
        {sorted.map((quote) => {
          const isLowest = quote.platformId === lowestPlatformId;
          const bestCoupon = quote.coupons.find((coupon) => coupon.best) ?? null;

          return (
            <div
              key={quote.platformId}
              className={`rounded-xl border p-4 ${isLowest ? 'border-brand-300 bg-brand-50/60' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex items-start gap-3">
                <img
                  src={quote.imageUrl}
                  alt={quote.platformName}
                  className="h-12 w-12 shrink-0 rounded-lg border border-slate-100 object-cover"
                  loading="lazy"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`chip ${platformBadgeClass(quote.platformId)}`}>{quote.platformName}</span>
                    {isLowest ? <span className="chip border-brand-300 bg-brand-500 text-white">最低</span> : null}
                  </div>
                  <p className="mt-1 truncate text-[13px] text-slate-500">{quote.shopName}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`tnum text-lg font-bold ${isLowest ? 'text-brand-600' : 'text-slate-900'}`}>
                    {formatYuan(quote.finalPrice)}
                  </p>
                  <p className="tnum text-[11px] text-slate-400 line-through">{formatYuan(quote.price)}</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {bestCoupon ? (
                    <span className="chip border-red-200 bg-red-50 text-red-600">
                      {couponRuleText(bestCoupon.threshold, bestCoupon.amount)}
                    </span>
                  ) : (
                    <span className="text-[13px] text-slate-400">暂无可用券</span>
                  )}
                </div>
                <a
                  href={quote.url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[13px] font-medium text-slate-700"
                >
                  去购买
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default PriceCompareTable;
