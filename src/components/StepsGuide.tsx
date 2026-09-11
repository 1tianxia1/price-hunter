import React from 'react';

interface StepsGuideProps {
  /** 当前进行到第几步（1 / 2 / 3） */
  current: 1 | 2 | 3;
}

const STEPS: Array<{ index: number; title: string; desc: string }> = [
  { index: 1, title: '复制链接', desc: '在京东 / 淘宝 / 拼多多 App 或网页复制商品链接' },
  { index: 2, title: '粘贴链接', desc: '粘贴到下方输入框，自动识别平台与商品' },
  { index: 3, title: '比价找券', desc: '一键对比全网价格、优惠券与历史走势' },
];

/**
 * 三步流程引导：给用户清晰的步骤感。
 */
const StepsGuide: React.FC<StepsGuideProps> = ({ current }) => (
  <ol className="grid gap-3 sm:grid-cols-3">
    {STEPS.map((step, i) => {
      const isDone = step.index < current;
      const isActive = step.index === current;

      return (
        <li
          key={step.index}
          className={`relative flex items-start gap-3 rounded-xl2 border p-4 transition-colors ${
            isActive
              ? 'border-brand-300 bg-brand-50/70'
              : isDone
                ? 'border-emerald-200 bg-emerald-50/50'
                : 'border-slate-200 bg-white'
          }`}
        >
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold ${
              isActive
                ? 'bg-brand-500 text-white'
                : isDone
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 text-slate-400'
            }`}
          >
            {isDone ? (
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0Z" />
              </svg>
            ) : (
              step.index
            )}
          </span>

          <div className="min-w-0">
            <p
              className={`text-sm font-semibold ${
                isActive ? 'text-brand-700' : isDone ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              {step.title}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{step.desc}</p>
          </div>

          {/* 步骤间的连接箭头（仅桌面端） */}
          {i < STEPS.length - 1 ? (
            <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-slate-300 sm:block" aria-hidden>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M7.5 4.5 13 10l-5.5 5.5-1.4-1.4 4.1-4.1-4.1-4.1 1.4-1.4Z" />
              </svg>
            </span>
          ) : null}
        </li>
      );
    })}
  </ol>
);

export default StepsGuide;
