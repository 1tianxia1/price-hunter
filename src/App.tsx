import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiRequestError, compare, fetchStatus, parseUrl } from './api';
import type { CompareResponse, ParseResponse, PlatformId, StatusResponse } from './types';
import type { PlatformTab } from './components/PlatformTabs';
import DemoDataBanner from './components/DemoDataBanner';
import StepsGuide from './components/StepsGuide';
import UrlInput from './components/UrlInput';
import LowestPriceCard from './components/LowestPriceCard';
import PriceCompareTable from './components/PriceCompareTable';
import PlatformTabs from './components/PlatformTabs';
import CouponList from './components/CouponList';
import HistoryPriceChart from './components/HistoryPriceChart';
import LoadingSkeleton from './components/LoadingSkeleton';
import EmptyState from './components/EmptyState';

/** 判断是否是被主动取消的请求（不提示错误）。 */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** 把异常转成可展示的中文文案。 */
function toMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

const App: React.FC = () => {
  const [input, setInput] = useState<string>('');
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [detecting, setDetecting] = useState<boolean>(false);
  const [detectError, setDetectError] = useState<string | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<PlatformId | 'all'>('all');
  /** 数据源状态：用于区分「没配 Key」与「配了但调不通」，文案差别很大 */
  const [status, setStatus] = useState<StatusResponse | null>(null);
  /** 用户手动关掉横幅后不再打扰（切换查询结果时会重置） */
  const [bannerClosed, setBannerClosed] = useState<boolean>(false);

  const parseAbortRef = useRef<AbortController | null>(null);
  const compareAbortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<number | null>(null);
  const lastParsedTextRef = useRef<string>('');

  /** 进页面先拉一次数据源状态，横幅才能说清楚到底卡在哪一步。 */
  useEffect(() => {
    const controller = new AbortController();

    fetchStatus(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setStatus(result);
      })
      .catch(() => {
        // 状态接口本身不可用时静默降级为「未知」，不影响比价主流程
      });

    return () => controller.abort();
  }, []);

  /** 卸载时取消在途请求与定时器。 */
  useEffect(
    () => () => {
      parseAbortRef.current?.abort();
      compareAbortRef.current?.abort();
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  /** 粘贴 / 输入后自动识别链接。 */
  const runParse = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || trimmed === lastParsedTextRef.current) return;

    parseAbortRef.current?.abort();
    const controller = new AbortController();
    parseAbortRef.current = controller;

    setDetecting(true);
    setDetectError(null);

    try {
      const result = await parseUrl(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      lastParsedTextRef.current = trimmed;
      setParsed(result);
    } catch (err) {
      if (isAbortError(err)) return;
      setParsed(null);
      setDetectError(toMessage(err, '链接识别失败，请检查是否复制完整'));
    } finally {
      if (!controller.signal.aborted) setDetecting(false);
    }
  }, []);

  const handleChange = useCallback(
    (value: string): void => {
      setInput(value);
      setParsed(null);
      setDetectError(null);

      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);

      if (!value.trim()) {
        lastParsedTextRef.current = '';
        setDetecting(false);
        return;
      }

      debounceRef.current = window.setTimeout(() => {
        void runParse(value);
      }, 450);
    },
    [runParse],
  );

  /** 主流程：比价找券。 */
  const handleSubmit = useCallback(async (): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError('请先粘贴商品链接，再点击「比价找券」');
      return;
    }

    compareAbortRef.current?.abort();
    const controller = new AbortController();
    compareAbortRef.current = controller;

    setLoading(true);
    setError(null);
    setData(null);

    try {
      const result = await compare(trimmed, controller.signal);
      if (controller.signal.aborted) return;
      setData(result);
      setActiveTab('all');
      setParsed({
        url: result.input.url,
        platformId: result.input.platformId,
        platformName: result.input.platformName,
        itemId: result.input.itemId,
      });
    } catch (err) {
      if (isAbortError(err)) return;
      setError(toMessage(err, '比价失败，请稍后重试'));
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [input]);

  /** 优惠券区的平台 Tab。 */
  const tabs = useMemo<PlatformTab[]>(() => {
    if (!data) return [];
    const total = data.quotes.reduce((sum, quote) => sum + quote.coupons.length, 0);
    return [
      { id: 'all', label: '全部平台', badge: String(total) },
      ...data.quotes.map((quote) => ({
        id: quote.platformId,
        label: quote.platformName,
        badge: String(quote.coupons.length),
      })),
    ];
  }, [data]);

  const currentStep: 1 | 2 | 3 = parsed ? 3 : 2;

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      {/* 顶部导航 */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-lg font-black text-white shadow-pop">
              P
            </span>
            <div>
              <p className="text-base font-bold leading-tight text-slate-900">PriceHunter</p>
              <p className="text-[11px] leading-tight text-slate-500">全网比价找券 · 历史价格查询</p>
            </div>
          </div>
          <a
            href="/api/health"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[13px] text-slate-400 transition-colors hover:text-brand-600"
          >
            数据源状态
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6 sm:py-6">
        {/* 数据状态横幅：
            只要本次结果里有演示数据就提示；文案由 /api/status 的 mode 决定，
            从而区分「没配 Key」和「配了但接口调不通」这两种完全不同的情况。
            没有查询结果时，若已探测到数据源异常也提前告知，避免用户白点一次。 */}
        <DemoDataBanner
          visible={!bannerClosed && (Boolean(data?.isMock) || (status !== null && status.mode !== 'live'))}
          reason={data?.warnings?.[0]}
          status={status}
          onClose={() => setBannerClosed(true)}
        />

        <StepsGuide current={currentStep} />

        <UrlInput
          value={input}
          onChange={handleChange}
          onSubmit={() => void handleSubmit()}
          onAutoDetect={(text) => void runParse(text)}
          parsed={parsed}
          detecting={detecting}
          detectError={detectError}
          loading={loading}
        />

        {/* 结果区 */}
        {loading ? <LoadingSkeleton /> : null}

        {!loading && error ? (
          <div className="card p-0">
            <EmptyState
              variant="error"
              title="比价失败"
              description={error}
              action={
                <button type="button" onClick={() => void handleSubmit()} className="btn-ghost">
                  重新查询
                </button>
              }
            />
          </div>
        ) : null}

        {!loading && !error && data ? (
          <div className="space-y-4">
            <LowestPriceCard
              lowest={data.lowest}
              isMock={data.isMock}
              platformCount={data.quotes.length}
            />

            <PriceCompareTable quotes={data.quotes} lowestPlatformId={data.lowest.platformId} />

            <section className="space-y-3">
              <PlatformTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
              <CouponList quotes={data.quotes} activePlatform={activeTab} />
            </section>

            <HistoryPriceChart history={data.history} />

            {data.warnings.length > 0 ? (
              <div className="rounded-xl2 border border-amber-200 bg-amber-50 p-4">
                <p className="text-[13px] font-semibold text-amber-900">提示</p>
                <ul className="mt-1.5 space-y-1">
                  {data.warnings.map((warning, index) => (
                    <li key={index} className="flex gap-2 text-[13px] leading-relaxed text-amber-800">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                      {warning}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="px-1 text-center text-[11px] text-slate-400">
              比价时间 {new Date(data.comparedAt).toLocaleString('zh-CN')} ·
              数据来自各平台官方联盟接口，价格可能随时变动，请以商品详情页为准
            </p>
          </div>
        ) : null}

        {!loading && !error && !data ? (
          <div className="card p-0">
            <EmptyState
              variant="search"
              title="粘贴商品链接，开始全网比价"
              description="自动对比京东 / 淘宝天猫 / 拼多多的当前价与优惠券，并查看近 180 天历史价格走势，帮你判断现在是不是入手好时机。"
            />
            <div className="border-t border-slate-100 px-6 py-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-[13px] font-semibold text-slate-700">全网比价</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                    一次查询，三大平台价格与券后价横向对比
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-[13px] font-semibold text-slate-700">自动找券</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                    聚合平台券 / 店铺券，直接算出券后到手价
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-[13px] font-semibold text-slate-700">历史价格</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                    看清当前价在历史区间中的位置，避开先涨后降
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </main>

      <footer className="mx-auto max-w-5xl px-4 sm:px-6">
        <div className="border-t border-slate-200 pt-4 text-center text-[11px] leading-relaxed text-slate-400">
          PriceHunter · 数据来源于各平台官方联盟接口，仅作比价参考
          <br />
          未配置 API Key 时展示演示数据，配置后自动切换为真实数据
        </div>
      </footer>
    </div>
  );
};

export default App;
