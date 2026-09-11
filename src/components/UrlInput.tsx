import React from 'react';
import type { ParseResponse } from '../types';
import { platformBadgeClass } from '../format';

interface UrlInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** 粘贴后立即触发识别 */
  onAutoDetect?: (text: string) => void;
  /** 识别结果 */
  parsed: ParseResponse | null;
  /** 识别中的状态 */
  detecting: boolean;
  /** 识别失败提示 */
  detectError: string | null;
  loading: boolean;
}

/** 示例链接，点击直接填充并识别。 */
export const SAMPLE_LINKS: Array<{ label: string; url: string }> = [
  { label: '京东', url: 'https://item.jd.com/100012043978.html' },
  { label: '淘宝', url: 'https://item.taobao.com/item.htm?id=674912345678' },
  { label: '拼多多', url: 'https://mobile.yangkeduo.com/goods.html?goods_id=584321098765' },
];

/**
 * 商品链接输入区：粘贴即自动识别，支持带中文口令的分享文案。
 */
const UrlInput: React.FC<UrlInputProps> = ({
  value,
  onChange,
  onSubmit,
  onAutoDetect,
  parsed,
  detecting,
  detectError,
  loading,
}) => {
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const text = (event.clipboardData?.getData('text') ?? '').trim();
    if (!text) return;
    // 粘贴即接管：用剪贴板内容整体替换输入框，并立刻触发识别
    event.preventDefault();
    onChange(text);
    onAutoDetect?.(text);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSubmit();
    }
  };

  const canSubmit = value.trim().length > 0 && !loading;

  return (
    <div className="card">
      <label htmlFor="product-url" className="card-title mb-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-500 text-xs font-bold text-white">
          2
        </span>
        粘贴商品链接
      </label>

      <div className="relative">
        <textarea
          id="product-url"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          rows={2}
          spellCheck={false}
          placeholder="在此粘贴商品链接，或整段复制的分享文案（如「8👈🔐 复制这行话…京东」）"
          className="input-lg resize-none pr-24 leading-relaxed"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="清空输入"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* 识别结果 / 错误提示 */}
      <div className="mt-3 min-h-[32px]">
        {detecting ? (
          <p className="flex items-center gap-2 text-[13px] text-slate-500">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500" />
            正在识别链接…
          </p>
        ) : null}

        {!detecting && parsed ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip ${platformBadgeClass(parsed.platformId)}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {parsed.platformName}
            </span>
            <span className="text-[13px] text-slate-500">
              商品 ID <span className="tnum font-medium text-slate-700">{parsed.itemId}</span>
            </span>
            <span className="text-[13px] text-emerald-600">✓ 已识别，可开始比价</span>
          </div>
        ) : null}

        {!detecting && detectError ? (
          <p className="text-[13px] font-medium text-red-600">{detectError}</p>
        ) : null}

        {!detecting && !parsed && !detectError ? (
          <p className="text-[13px] text-slate-400">支持京东 / 淘宝 / 天猫 / 拼多多的商品链接与分享文案</p>
        ) : null}
      </div>

      {/* 底部操作区：上下 16px、左右 24px，按钮不贴边 */}
      <div className="action-bar -mx-4 mt-2 border-t border-slate-100 sm:-mx-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-slate-400">试试示例：</span>
          {SAMPLE_LINKS.map((sample) => (
            <button
              key={sample.label}
              type="button"
              onClick={() => {
                onChange(sample.url);
                onAutoDetect?.(sample.url);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-600"
            >
              {sample.label}
            </button>
          ))}
        </div>

        <button type="button" onClick={onSubmit} disabled={!canSubmit} className="btn-primary w-full sm:w-auto">
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              比价中…
            </>
          ) : (
            <>
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
                <path d="M3 4a1 1 0 0 1 1-1h2.2a1 1 0 0 1 .95.69l1.1 3.31H16a1 1 0 0 1 .97 1.24l-1.2 5A1 1 0 0 1 14.8 14H8.3a1 1 0 0 1-.95-.69L5.4 5.5H4a1 1 0 0 1-1-1Zm4.3 1L6.35 12h8.45l.96-4H8.25l-.95-3Z" />
                <circle cx="9" cy="16.5" r="1.3" />
                <circle cx="14.5" cy="16.5" r="1.3" />
              </svg>
              比价找券
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default UrlInput;
