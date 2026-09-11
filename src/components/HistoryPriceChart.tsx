import React, { useId, useMemo, useState } from 'react';
import type { HistoryData, HistorySource } from '../types';
import { formatYuan, shortDate } from '../format';
import EmptyState from './EmptyState';

interface HistoryPriceChartProps {
  history: HistoryData;
}

/** 各数据源的中文标注。 */
const SOURCE_LABEL: Record<HistorySource, string> = {
  local: '数据来源：本地价格库',
  dataoke: '数据来源：大淘客开放平台',
  thirdparty: '数据来源：第三方历史价接口',
  simulated: '数据来源：模拟数据',
};

/** 空态文案：无真实历史数据时不画假曲线。 */
const EMPTY_MESSAGE = '暂无历史数据，每次查询会自动记录，累积几天后即可看到真实价格曲线';

const VB_W = 720;
const VB_H = 300;
const PAD = { left: 58, right: 20, top: 28, bottom: 38 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_H;

/**
 * 手写 SVG 历史价格折线图（不引入图表库）。
 * 包含：价格走势、最高 / 最低 / 均价参考线、当前价标注、悬浮十字准星与结论文案。
 */
const HistoryPriceChart: React.FC<HistoryPriceChartProps> = ({ history }) => {
  const rawId = useId();
  const gradientId = `hp-grad-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const model = useMemo(() => {
    const points = history?.points ?? [];
    if (points.length < 2) return null;

    const prices = points.map((point) => point.price);
    const rawMax = Math.max(...prices);
    const rawMin = Math.min(...prices);
    const span = rawMax - rawMin || Math.max(100, Math.round(rawMax * 0.1));
    const lo = Math.max(0, rawMin - span * 0.18);
    const hi = rawMax + span * 0.14;
    const scale = hi - lo || 1;

    const xAt = (index: number): number =>
      PAD.left + (index / (points.length - 1)) * PLOT_W;
    const yAt = (price: number): number =>
      PAD.top + (1 - (price - lo) / scale) * PLOT_H;

    const linePath = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(2)},${yAt(point.price).toFixed(2)}`)
      .join(' ');

    const areaPath = `${linePath} L${xAt(points.length - 1).toFixed(2)},${BASELINE} L${xAt(0).toFixed(2)},${BASELINE} Z`;

    const ticks = Array.from({ length: 5 }, (_, i) => lo + (scale * i) / 4);
    const labelIndexes = Array.from({ length: 5 }, (_, i) =>
      Math.round((i / 4) * (points.length - 1)),
    );

    const lastIndex = points.length - 1;

    return {
      points,
      lo,
      hi,
      xAt,
      yAt,
      linePath,
      areaPath,
      ticks,
      labelIndexes,
      lastIndex,
      currentX: xAt(lastIndex),
      currentY: yAt(points[lastIndex]?.price ?? history.current ?? 0),
      maxY: yAt(rawMax),
      minY: yAt(rawMin),
      avgY: yAt(history.avg),
    };
  }, [history]);

  // 无真实历史数据：展示空态，绝不画假曲线误导购买决策
  if (!model) {
    return (
      <section className="card p-0">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <h3 className="card-title">
            <span className="h-4 w-1 rounded-full bg-brand-500" />
            历史价格走势
          </h3>
        </div>
        <EmptyState variant="empty" title="暂无历史数据" description={history.message || EMPTY_MESSAGE} />
      </section>
    );
  }

  const { points, xAt, yAt, ticks, labelIndexes } = model;

  const handleMove = (event: React.MouseEvent<SVGSVGElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * VB_W;
    const ratio = (viewX - PAD.left) / PLOT_W;
    const index = Math.round(ratio * (points.length - 1));
    setHoverIndex(Math.min(points.length - 1, Math.max(0, index)));
  };

  const hovered = hoverIndex === null ? null : points[hoverIndex];
  const hoveredX = hovered ? xAt(hoverIndex as number) : 0;
  const hoveredY = hovered ? yAt(hovered.price) : 0;
  const tooltipX = Math.min(VB_W - PAD.right - 62, Math.max(PAD.left + 62, hoveredX));

  const belowAvg = history.changeFromAvg <= 0;
  const belowMax = history.changeFromMax <= 0;
  // 当前价低于历史上 60% 以上的时间，视为相对低点（降价 = 红，涨价 = 绿）
  const isGoodTiming = history.percentile >= 60;

  return (
    <section className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="card-title">
          <span className="h-4 w-1 rounded-full bg-brand-500" />
          历史价格走势
          {history.isMock ? (
            <span className="chip border-amber-300 bg-amber-100 text-amber-800">演示数据</span>
          ) : null}
        </h3>
        <span className="text-[13px] text-slate-400">
          近 {history.recordedDays > 0 ? history.recordedDays : points.length} 天
        </span>
      </div>

      <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-2 sm:p-3">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="h-auto w-full touch-none select-none"
          role="img"
          aria-label={`历史价格走势图，当前价 ${formatYuan(history.current)}`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF5A1F" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#FF5A1F" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* 横向网格 + 纵轴刻度 */}
          {ticks.map((tick, index) => {
            const y = yAt(tick);
            return (
              <g key={index}>
                <line
                  x1={PAD.left}
                  y1={y}
                  x2={VB_W - PAD.right}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeWidth="1"
                  strokeDasharray={index === 0 ? '0' : '3 4'}
                />
                <text x={PAD.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="#94A3B8">
                  ¥{Math.round(tick / 100)}
                </text>
              </g>
            );
          })}

          {/* 参考线：最高 / 最低 / 均价 */}
          <line
            x1={PAD.left}
            y1={model.maxY}
            x2={VB_W - PAD.right}
            y2={model.maxY}
            stroke="#94A3B8"
            strokeWidth="1.2"
            strokeDasharray="6 4"
          />
          <text x={VB_W - PAD.right} y={model.maxY - 6} textAnchor="end" fontSize="11" fill="#64748B">
            最高 ¥{Math.round(history.max / 100)}
          </text>

          <line
            x1={PAD.left}
            y1={model.minY}
            x2={VB_W - PAD.right}
            y2={model.minY}
            stroke="#16A34A"
            strokeWidth="1.2"
            strokeDasharray="6 4"
          />
          <text x={VB_W - PAD.right} y={model.minY + 15} textAnchor="end" fontSize="11" fill="#16A34A">
            最低 ¥{Math.round(history.min / 100)}
          </text>

          <line
            x1={PAD.left}
            y1={model.avgY}
            x2={VB_W - PAD.right}
            y2={model.avgY}
            stroke="#CBD5E1"
            strokeWidth="1"
            strokeDasharray="2 5"
          />
          <text x={PAD.left + 4} y={model.avgY - 5} fontSize="11" fill="#94A3B8">
            均价 ¥{Math.round(history.avg / 100)}
          </text>

          {/* 面积 + 折线 */}
          <path d={model.areaPath} fill={`url(#${gradientId})`} />
          <path
            d={model.linePath}
            fill="none"
            stroke="#FF5A1F"
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* 当前价终点标注 */}
          <circle cx={model.currentX} cy={model.currentY} r="5" fill="#fff" stroke="#FF5A1F" strokeWidth="3" />
          <g transform={`translate(${Math.min(model.currentX, VB_W - PAD.right - 78)}, ${Math.max(PAD.top + 12, model.currentY - 14)})`}>
            <rect x="0" y="0" width="76" height="20" rx="6" fill="#FF5A1F" />
            <text x="38" y="14" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
              现价 {formatYuan(history.current)}
            </text>
          </g>

          {/* 横轴日期 */}
          {labelIndexes.map((index, i) => (
            <text
              key={i}
              x={xAt(index)}
              y={BASELINE + 22}
              textAnchor={i === 0 ? 'start' : i === labelIndexes.length - 1 ? 'end' : 'middle'}
              fontSize="11"
              fill="#94A3B8"
            >
              {shortDate(points[index]?.date ?? '')}
            </text>
          ))}

          {/* 悬浮准星 */}
          {hovered ? (
            <g pointerEvents="none">
              <line
                x1={hoveredX}
                y1={PAD.top}
                x2={hoveredX}
                y2={BASELINE}
                stroke="#FF5A1F"
                strokeWidth="1"
                strokeDasharray="4 3"
                opacity="0.7"
              />
              <circle cx={hoveredX} cy={hoveredY} r="4.5" fill="#FF5A1F" stroke="#fff" strokeWidth="2" />
              <g transform={`translate(${tooltipX - 62}, ${Math.max(PAD.top + 4, hoveredY - 54)})`}>
                <rect width="124" height="44" rx="8" fill="#0F172A" opacity="0.92" />
                <text x="62" y="18" textAnchor="middle" fontSize="11" fill="#CBD5E1">
                  {hovered.date}
                </text>
                <text x="62" y="35" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">
                  {formatYuan(hovered.price)}
                </text>
              </g>
            </g>
          ) : null}

          {/* 事件捕获层 */}
          <rect
            x={PAD.left}
            y={PAD.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
          />
        </svg>
      </div>

      {/* 数据来源标注：本地库额外说明已记录天数 */}
      <p className="mt-3 text-center text-[11px] text-slate-400">
        {SOURCE_LABEL[history.source] ?? SOURCE_LABEL.simulated}
        {history.source === 'local'
          ? ` · 已记录 ${history.recordedDays || points.length} 天`
          : ''}
      </p>

      {/* 统计与结论 */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">当前价</p>
          <p className="tnum mt-1 text-base font-bold text-brand-600">{formatYuan(history.current)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">历史最低</p>
          <p className="tnum mt-1 text-base font-bold text-emerald-600">{formatYuan(history.min)}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{history.minDate}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">历史最高</p>
          <p className="tnum mt-1 text-base font-bold text-slate-700">{formatYuan(history.max)}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">{history.maxDate}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] text-slate-500">较最高价</p>
          <p className={`tnum mt-1 text-base font-bold ${belowMax ? 'text-red-600' : 'text-emerald-600'}`}>
            {belowMax ? '↓' : '↑'} {formatYuan(Math.abs(history.changeFromMax))}
          </p>
          <p className={`mt-0.5 text-[11px] ${belowAvg ? 'text-red-600' : 'text-emerald-600'}`}>
            较均价 {belowAvg ? '低' : '高'} {formatYuan(Math.abs(history.changeFromAvg))}
          </p>
        </div>
      </div>

      <div
        className={`mt-3 rounded-xl border p-4 ${
          isGoodTiming ? 'border-red-100 bg-red-50/50' : 'border-emerald-100 bg-emerald-50/50'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className={`text-sm font-semibold ${isGoodTiming ? 'text-red-700' : 'text-emerald-700'}`}>
            当前价低于近 {points.length} 天中 {history.percentile}% 的时间
          </p>
          <span
            className={`chip ${
              isGoodTiming
                ? 'border-red-200 bg-red-100 text-red-700'
                : 'border-emerald-200 bg-emerald-100 text-emerald-700'
            }`}
          >
            {isGoodTiming ? '入手好时机' : '价格偏高，可观望'}
          </span>
        </div>
        <ul className="mt-2 space-y-1">
          {history.insights.map((insight, index) => (
            <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-slate-600">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
              {insight}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
};

export default HistoryPriceChart;
