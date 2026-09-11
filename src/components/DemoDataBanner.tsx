import React, { useState } from 'react';
import type { DataMode, StatusResponse } from '../types';

interface DemoDataBannerProps {
  /** 是否为演示数据 */
  visible: boolean;
  /** 额外的说明文案（如降级原因） */
  reason?: string;
  /** 数据源探测结果；拿不到时不展示细节区 */
  status?: StatusResponse | null;
  /** 关闭回调，不传则不显示关闭按钮 */
  onClose?: () => void;
}

/** 各种数据模式对应的横幅文案。 */
const MODE_COPY: Record<DataMode, { title: string; body: string; tone: 'warn' | 'info' }> = {
  'no-key': {
    title: '当前为演示数据，配置 API Key 后自动切换真实数据',
    body: '尚未检测到联盟 API 密钥，以下价格、优惠券与历史曲线均为自动生成的示例数据，仅用于演示完整流程。',
    tone: 'warn',
  },
  unreachable: {
    title: 'API 密钥已配置，但当前连不上联盟网关',
    body: '密钥读取正常，但服务端访问京东 / 淘宝 / 拼多多的接口时网络不通（超时或被拒绝）。这通常是域名解析、防火墙、代理或服务器出网限制导致的——注意演示数据并不是「没配 Key」引起的。',
    tone: 'warn',
  },
  degraded: {
    title: 'API 密钥已配置，但联盟接口调用失败',
    body: '密钥已读取，接口也确实调到了，但平台返回了错误。最常见的原因是联盟后台还没开通对应接口权限，或密钥 / 推广位配置有误。具体原因见下方明细。',
    tone: 'warn',
  },
  partial: {
    title: '部分平台已切换到真实数据',
    body: '有平台调通了、有平台没有。未调通的平台仍在展示演示数据，具体原因见下方明细。',
    tone: 'info',
  },
  live: {
    title: '正在使用真实数据',
    body: '各平台密钥均可用，价格与优惠券来自联盟接口实时返回。',
    tone: 'info',
  },
};

/** 探测状态的中文标签与配色。 */
const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  ok: { label: '可用', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  'no-key': { label: '未配置', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  network: { label: '网络不通', className: 'bg-red-100 text-red-700 border-red-200' },
  error: { label: '调用失败', className: 'bg-amber-100 text-amber-800 border-amber-200' },
};

/**
 * 数据状态横幅。
 *
 * 关键设计：**必须区分「没配 Key」和「配了但调不通」**。
 * 早期版本只判断 isMock，于是只要接口失败就统一提示「尚未检测到联盟 API 密钥」，
 * 用户明明已经填了 Key，看到的却是"没配"——文案直接是错的，也没给出真正的原因。
 * 现在根据后端 /api/status 推导出的 mode 精准表达，并提供可展开的明细。
 */
const DemoDataBanner: React.FC<DemoDataBannerProps> = ({ visible, reason, status, onClose }) => {
  const [expanded, setExpanded] = useState(false);

  if (!visible) return null;

  const mode: DataMode = status?.mode ?? 'no-key';
  const copy = MODE_COPY[mode] ?? MODE_COPY['no-key'];

  const probes = status?.live ? Object.values(status.live) : [];
  const hasDetail = probes.length > 0;
  const isOk = mode === 'live';

  const toneClass = isOk
    ? 'border-emerald-300 bg-emerald-50'
    : 'border-amber-300 bg-amber-50';
  const iconClass = isOk ? 'bg-emerald-500' : 'bg-amber-400';
  const titleClass = isOk ? 'text-emerald-900' : 'text-amber-900';
  const bodyClass = isOk ? 'text-emerald-800/90' : 'text-amber-800/90';

  return (
    <div className={`animate-fade-up rounded-xl2 border p-4 sm:p-5 ${toneClass}`}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${iconClass}`}
          aria-hidden
        >
          {isOk ? '✓' : '!'}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${titleClass}`}>{copy.title}</p>
          <p className={`mt-1 text-xs leading-relaxed sm:text-[13px] ${bodyClass}`}>
            {copy.body}
          </p>

          {reason ? (
            <p className={`mt-1.5 text-xs font-medium ${titleClass} opacity-80`}>降级原因：{reason}</p>
          ) : null}

          {/* 明细：逐个平台展示状态与真实报错 */}
          {hasDetail ? (
            <>
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className={`mt-2 text-xs font-semibold underline decoration-dotted underline-offset-2 ${titleClass}`}
              >
                {expanded ? '收起数据源明细' : `查看数据源明细（${probes.length} 个）`}
              </button>

              {expanded ? (
                <ul className="mt-2 space-y-2">
                  {probes.map((probe) => {
                    const style = STATUS_STYLE[probe.status] ?? STATUS_STYLE.error;
                    return (
                      <li
                        key={probe.id}
                        className="rounded-lg border border-white/70 bg-white/70 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700">{probe.name}</span>
                          <span className={`chip border ${style.className}`}>{style.label}</span>
                        </div>
                        <p className="mt-1 break-words text-[11px] leading-relaxed text-slate-600">
                          {probe.message}
                        </p>
                      </li>
                    );
                  })}
                  <li className="rounded-lg border border-white/70 bg-white/70 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-700">历史价格</span>
                      <span
                        className={`chip border ${
                          status?.history?.hasRealSource
                            ? STATUS_STYLE.ok.className
                            : STATUS_STYLE['no-key'].className
                        }`}
                      >
                        {status?.history?.hasRealSource ? '有可用数据源' : '仅本地累积'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                      {status?.history?.local
                        ? '本地价格库已启用：每次比价会自动记录，累积多天后可看到真实曲线。'
                        : '本地价格库已关闭。'}
                      {status?.history?.dataoke
                        ? ' 大淘客历史价已配置。'
                        : ' 未配置大淘客，淘宝 / 天猫拿不到第三方历史曲线。'}
                    </p>
                  </li>
                </ul>
              ) : null}
            </>
          ) : (
            <p className={`mt-1.5 text-xs leading-relaxed ${bodyClass}`}>
              在项目根目录{' '}
              <code className="rounded bg-white/60 px-1 py-0.5 font-mono text-[11px]">.env</code>{' '}
              中填入京东联盟 / 淘宝客 / 多多进宝 / 大淘客历史价的密钥后刷新页面即可切换为真实数据。
            </p>
          )}
        </div>

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className={`-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 transition-colors ${titleClass} hover:bg-white/60`}
            aria-label="关闭数据状态提示"
          >
            <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default DemoDataBanner;
