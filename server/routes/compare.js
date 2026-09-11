import { Router } from 'express';
import { resolveInput, buildSearchKeyword, detectPlatform } from '../utils/urlParser.js';
import { pickLowest } from '../utils/quote.js';
import { getAdapter, otherAdapters } from '../adapters/registry.js';
import { queryHistory } from '../adapters/history.js';
import * as priceStore from '../utils/priceStore.js';
import { ApiError, toApiError } from '../utils/errors.js';
import jdAdapter from '../adapters/jd.js';
import taobaoAdapter from '../adapters/taobao.js';
import pddAdapter from '../adapters/pdd.js';
import dataokeAdapter from '../adapters/dataoke.js';

/**
 * 比价相关路由。
 * 统一响应契约：
 *   成功 -> { success: true, ...业务字段 }
 *   失败 -> { success: false, error: { code, message } }，message 可直接展示给用户
 */

const router = Router();

/**
 * 包装异步 handler，把抛出的异常交给 Express 错误中间件统一处理。
 * @param {(req: any, res: any, next: any) => Promise<any>} handler
 * @returns {(req: any, res: any, next: any) => void}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    handler(req, res, next).catch((err) => next(toApiError(err)));
  };
}

/**
 * 读取请求体，保证一定是对象。
 * @param {any} req
 * @returns {Record<string, any>}
 */
function readBody(req) {
  const body = req.body;
  if (!body || typeof body !== 'object') return {};
  return body;
}

/**
 * 把 Adapter 附带的 warning 收进 warnings 数组，并从对象上摘掉。
 * @param {any} target
 * @param {string[]} warnings
 * @returns {void}
 */
function collectWarning(target, warnings) {
  if (target && typeof target.warning === 'string' && target.warning) {
    warnings.push(target.warning);
    delete target.warning;
  }
}

/** GET /health —— 健康检查 + 各数据源配置状态（不暴露密钥）。 */
router.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'price-hunter-api',
    time: new Date().toISOString(),
    configured: buildConfigStatus(),
  });
});

/**
 * 汇总各数据源的「已配置 / 未配置」状态。
 * 只返回布尔值，绝不回传密钥本身。
 * @returns {Record<string, boolean>}
 */
function buildConfigStatus() {
  return {
    jd: jdAdapter.hasKeys(),
    taobao: taobaoAdapter.hasKeys(),
    pdd: pddAdapter.hasKeys(),
    dataoke: dataokeAdapter.hasKeys(),
    thirdPartyHistory: Boolean(process.env.HISTORY_API_BASE_URL && process.env.HISTORY_API_KEY),
    localHistory: priceStore.isEnabled(),
  };
}

/**
 * GET /api/status —— 「数据状态」面板数据。
 *
 * 为什么需要它：页面横幅原本只判断 `isMock`，于是只要任何一家联盟接口失败
 * 就笼统提示「尚未检测到联盟 API 密钥」——用户明明已经填了 Key，文案却是错的。
 * 这个接口把状态拆成三层，让前端能说清楚**到底哪一步不行**：
 *   1. keys      —— 密钥是否齐全（纯本地判断，不发网络请求）
 *   2. live      —— 实际打一次网关，验证密钥是否真的有效（权限/时间戳/网络问题）
 *   3. history   —— 历史价各数据源可用性
 */
router.get('/status', async (_req, res) => {
  const keys = buildConfigStatus();

  // 实时探测：只用一个最小的只读查询，避免消耗配额。
  // 失败原因必须原样带回去，它才是用户真正需要看到的行动指引。
  const probes = await Promise.all([
    probe('jd', '京东联盟', () => jdAdapter.probe()),
    probe('taobao', '淘宝客', () => taobaoAdapter.probe()),
    probe('pdd', '多多进宝', () => pddAdapter.probe()),
  ]);

  const live = {};
  for (const item of probes) live[item.id] = item;

  const anyMock = probes.some((item) => item.status !== 'ok');

  res.json({
    success: true,
    time: new Date().toISOString(),
    keys,
    live,
    history: {
      local: keys.localHistory,
      dataoke: keys.dataoke,
      thirdParty: keys.thirdPartyHistory,
      // 历史价能不能拿到真实曲线：本地库永远可用，大淘客/第三方看是否配置
      hasRealSource: keys.localHistory || keys.dataoke || keys.thirdPartyHistory,
    },
    // 页面据此决定横幅文案：是「没配 Key」还是「配了但调不通」
    mode: deriveMode(keys, probes),
    anyMock,
  });
});

/**
 * 探测单个上游是否真的可用。绝不抛异常——失败也是有效结果。
 *
 * @param {string} id 平台标识
 * @param {string} name 中文名
 * @param {() => Promise<any>} run 探测函数
 * @returns {Promise<{id: string, name: string, configured: boolean, status: string, message: string}>}
 */
async function probe(id, name, run) {
  const configured = id === 'jd' ? jdAdapter.hasKeys()
    : id === 'taobao' ? taobaoAdapter.hasKeys()
      : pddAdapter.hasKeys();

  if (!configured) {
    return { id, name, configured: false, status: 'no-key', message: `未配置${name}密钥` };
  }

  try {
    await run();
    return { id, name, configured: true, status: 'ok', message: '密钥有效，接口可正常调用' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // 网络不通 / 权限未开通 / 时间戳偏差，在这里被区分出来给用户看
    const status = /超时|timeout|fetch failed|ENOTFOUND|ECONN/i.test(message)
      ? 'network'
      : 'error';
    return { id, name, configured: true, status, message };
  }
}

/**
 * 推导整站数据模式，供前端选择横幅文案。
 * @param {Record<string, boolean>} keys
 * @param {Array<{status: string}>} probes
 * @returns {'live'|'partial'|'no-key'|'unreachable'|'degraded'}
 */
function deriveMode(keys, probes) {
  const anyKey = keys.jd || keys.taobao || keys.pdd;
  const liveCount = probes.filter((item) => item.status === 'ok').length;

  if (liveCount === probes.length) return 'live';
  if (!anyKey) return 'no-key';
  if (liveCount > 0) return 'partial';

  // 有 Key 但一个都调不通：区分「网络到不了」还是「接口报错」
  const allNetwork = probes.every((item) => item.status === 'network' || item.status === 'no-key');
  return allNetwork ? 'unreachable' : 'degraded';
}

/** POST /api/parse —— 粘贴即识别：解析链接所属平台与商品 ID（或口令关键词）。 */
router.post(
  '/parse',
  asyncHandler(async (req, res) => {
    const { url, text } = readBody(req);
    const resolved = resolveInput(url ?? text ?? '');
    res.json({ success: true, ...resolved });
  }),
);

/** POST /api/compare —— 主流程：跨平台比价 + 找券 + 历史价。 */
router.post(
  '/compare',
  asyncHandler(async (req, res) => {
    const { url, text } = readBody(req);
    const input = String(url ?? text ?? '').trim();
    if (!input) {
      throw new ApiError(400, '请先粘贴商品链接，再点击「比价找券」');
    }

    const resolved = resolveInput(input);
    const adapter = getAdapter(resolved.platformId);
    if (!adapter) {
      throw new ApiError(400, `暂不支持的平台：${resolved.platformId}`);
    }

    /** @type {string[]} */
    const warnings = [];

    // 1) 取原平台商品
    //    - itemId 模式：完整链接，走商品详情查询
    //    - keyword 模式：短链 / 口令，用文案里的商品标题在原平台搜同款
    let product;
    let keyword;
    if (resolved.mode === 'keyword') {
      product = await adapter.searchByKeyword(resolved.keyword, resolved.keyword);
      if (!product) {
        throw new ApiError(
          404,
          `未能在${resolved.platformName}找到同款商品（${resolved.keyword}），请打开商品页后复制完整链接重试`,
        );
      }
      keyword = resolved.keyword;
    } else {
      product = await adapter.queryProduct(resolved.itemId);
      keyword = buildSearchKeyword(product.title) || resolved.itemId;
    }
    collectWarning(product, warnings);

    // 2) 其它平台按关键词匹配同款（keyword 已在上面按模式赋值）
    const candidates = await Promise.all(
      otherAdapters(resolved.platformId).map(async (other) => {
        try {
          return await other.searchByKeyword(keyword, product.title);
        } catch (err) {
          // 跨平台搜索失败不阻塞主流程，但原因必须让用户看到
          // （最常见：联盟后台还没开通对应接口权限）
          warnings.push(err?.message ?? `${other.platformName} 跨平台搜索失败`);
          return null;
        }
      }),
    );

    const quotes = [product];
    for (const quote of candidates) {
      if (!quote) continue;
      collectWarning(quote, warnings);
      quotes.push(quote);
    }

    if (otherAdapters(resolved.platformId).length > 0 && quotes.length === 1) {
      warnings.push('其它平台未匹配到同款商品，当前仅展示该平台结果');
    }

    // 2.5) 把本次观测写入自建本地价格库（先记录再查历史，保证本次价格计入曲线）
    if (priceStore.isEnabled()) {
      try {
        await priceStore.recordObservations(
          quotes.map((quote) => ({
            platformId: quote.platformId,
            itemId: quote.itemId,
            title: quote.title,
            price: quote.price,
            finalPrice: quote.finalPrice,
          })),
        );
      } catch (err) {
        // 落盘失败只提示，不影响本次比价结果
        warnings.push(`本地价格库写入失败，本次观测未记录：${err?.message ?? '未知错误'}`);
      }
    }

    // 3) 全网最低价结论
    const lowest = pickLowest(quotes);

    // 4) 历史价格（独立数据源）
    const history = await queryHistory({
      url: resolved.url,
      itemId: resolved.itemId || product.itemId,
      platformId: resolved.platformId,
      title: product.title,
      currentPrice: product.finalPrice,
    });
    collectWarning(history, warnings);

    const isMock = quotes.some((quote) => quote.isMock) || Boolean(history?.isMock);

    res.json({
      success: true,
      input: {
        url: resolved.url,
        platformId: resolved.platformId,
        platformName: resolved.platformName,
        itemId: resolved.itemId || product.itemId,
        keyword,
        mode: resolved.mode,
      },
      product,
      quotes,
      lowest,
      history,
      isMock,
      warnings,
      comparedAt: new Date().toISOString(),
    });
  }),
);

/** POST /api/history —— 单独查询历史价格。 */
router.post(
  '/history',
  asyncHandler(async (req, res) => {
    const { url, text, keyword, currentPrice } = readBody(req);
    const rawInput = String(url ?? text ?? '').trim();

    if (!rawInput && !keyword) {
      throw new ApiError(400, '请提供商品链接或关键词');
    }

    let itemId = '';
    let platformId = '';
    let resolvedUrl = rawInput;
    let resolvedTitle = String(keyword ?? '');
    let price = Number(currentPrice ?? 0);

    if (rawInput) {
      const parsed = detectPlatform(rawInput);
      itemId = parsed.itemId;
      platformId = parsed.platformId;
      resolvedUrl = parsed.url;

      const adapter = getAdapter(parsed.platformId);
      if (adapter && price <= 0) {
        const quote = await adapter.queryProduct(parsed.itemId);
        price = quote.finalPrice;
        resolvedTitle = quote.title || resolvedTitle;
      }
    }

    const history = await queryHistory({
      url: resolvedUrl,
      itemId,
      platformId,
      title: resolvedTitle,
      keyword: resolvedTitle,
      currentPrice: price,
    });

    /** @type {string[]} */
    const warnings = [];
    collectWarning(history, warnings);

    res.json({
      success: true,
      history,
      warnings,
      isMock: Boolean(history?.isMock),
      queriedAt: new Date().toISOString(),
    });
  }),
);

export default router;
