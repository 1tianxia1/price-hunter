import React from 'react';

interface EmptyStateProps {
  /** 主标题 */
  title: string;
  /** 描述文案 */
  description?: string;
  /** 图标类型 */
  variant?: 'search' | 'error' | 'empty';
  /** 操作区 */
  action?: React.ReactNode;
}

const ICONS: Record<NonNullable<EmptyStateProps['variant']>, React.ReactNode> = {
  search: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <circle cx="21" cy="21" r="13" />
      <path d="m31 31 9 9" strokeLinecap="round" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <circle cx="24" cy="24" r="17" />
      <path d="M24 15v12" strokeLinecap="round" />
      <path d="M24 32.5v1.5" strokeLinecap="round" />
    </svg>
  ),
  empty: (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
      <path d="M8 16h32l-3 22a3 3 0 0 1-3 2.5H14A3 3 0 0 1 11 38L8 16Z" strokeLinejoin="round" />
      <path d="M17 16v-3a7 7 0 0 1 14 0v3" strokeLinecap="round" />
    </svg>
  ),
};

/**
 * 空状态 / 错误状态占位。
 * 保证任何异常路径都有可行动文案，不白屏、不静默。
 */
const EmptyState: React.FC<EmptyStateProps> = ({ title, description, variant = 'empty', action }) => {
  const isError = variant === 'error';

  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center sm:py-16">
      <div
        className={`mb-4 flex h-20 w-20 items-center justify-center rounded-2xl ${
          isError ? 'bg-red-50 text-red-400' : 'bg-slate-100 text-slate-400'
        }`}
      >
        {ICONS[variant]}
      </div>
      <p className={`text-base font-semibold ${isError ? 'text-red-600' : 'text-slate-700'}`}>{title}</p>
      {description ? (
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
};

export default EmptyState;
