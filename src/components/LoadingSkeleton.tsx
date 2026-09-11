import React from 'react';

/**
 * 加载骨架屏：结构与真实结果区对齐，避免加载完成时的布局跳动。
 */
const LoadingSkeleton: React.FC = () => (
  <div className="space-y-4" aria-busy="true" aria-live="polite">
    {/* 最低价结论卡骨架 */}
    <div className="card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1 space-y-3">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-9 w-48" />
          <div className="skeleton h-3.5 w-64" />
        </div>
        <div className="skeleton h-11 w-32 rounded-xl" />
      </div>
    </div>

    {/* 比价表骨架 */}
    <div className="card">
      <div className="skeleton mb-4 h-4 w-32" />
      <div className="space-y-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-4">
            <div className="skeleton h-12 w-12 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-3.5 w-3/4" />
              <div className="skeleton h-3 w-1/3" />
            </div>
            <div className="skeleton h-5 w-20" />
            <div className="skeleton h-8 w-20 rounded-lg" />
          </div>
        ))}
      </div>
    </div>

    {/* 历史价格图骨架 */}
    <div className="card">
      <div className="skeleton mb-4 h-4 w-40" />
      <div className="skeleton h-56 w-full rounded-xl" />
    </div>

    <p className="text-center text-sm text-slate-400">正在查询各平台价格与优惠券…</p>
  </div>
);

export default LoadingSkeleton;
