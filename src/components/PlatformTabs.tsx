import React from 'react';
import type { PlatformId } from '../types';

export interface PlatformTab {
  id: PlatformId | 'all';
  label: string;
  /** 右下角小徽标文案，如券数量 */
  badge?: string;
}

interface PlatformTabsProps {
  tabs: PlatformTab[];
  active: PlatformId | 'all';
  onChange: (id: PlatformId | 'all') => void;
}

/**
 * 平台切换 Tab：用于在优惠券 / 明细区切换查看不同平台。
 */
const PlatformTabs: React.FC<PlatformTabsProps> = ({ tabs, active, onChange }) => {
  if (tabs.length === 0) return null;

  return (
    <div
      role="tablist"
      aria-label="平台切换"
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-medium transition-colors ${
              isActive
                ? 'border-brand-500 bg-brand-500 text-white shadow-pop'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
            }`}
          >
            {tab.label}
            {tab.badge ? (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  isActive ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
};

export default PlatformTabs;
