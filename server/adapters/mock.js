import { buildQuote, roundYuan } from '../utils/quote.js';

/**
 * 把 Date 格式化为本地日期字符串（YYYY-MM-DD），避免 toISOString 的 UTC 偏移
 * 在 UTC+8 时区把末点日期算成「昨天」，导致历史曲线末点与本地今天对不上。
 * @param {Date} date
 * @returns {string}
 */
function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 演示数据（Mock）生成器。
 *
 * 设计目标：
 *  1. **确定性** —— 同一个商品 ID / 关键词永远得到同一份数据，刷新不跳变；
 *  2. **结构一致** —— 与真实 Adapter 返回完全相同的 ProductQuote，前端无感知；
 *  3. **有说服力** —— 不同平台价格与券面额有真实差异，能跑通「全网最低价」结论。
 */

/** FNV-1a 字符串哈希，用于把任意种子映射到稳定整数。 */
function hashString(input) {
  let hash = 2166136261;
  const text = String(input ?? '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * mulberry32 伪随机数生成器：同一种子 => 同一序列。
 * @param {string|number} seed
 * @returns {() => number} 返回 [0, 1) 的随机数
 */
export function createRng(seed) {
  let state = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 演示商品原型：覆盖不同价位，让比价表有真实感。 */
const ARCHETYPES = [
  {
    keywords: 'Redmi K80 Pro',
    title: '小米 Redmi K80 Pro 骁龙8至尊版 12GB+512GB 5G手机 雪岩白',
    base: 329900,
  },
  {
    keywords: 'AirPods Pro 3',
    title: 'Apple AirPods Pro 3 主动降噪 无线蓝牙耳机 适用 iPhone',
    base: 179900,
  },
  {
    keywords: 'ThinkPad X1 Carbon',
    title: '联想 ThinkPad X1 Carbon AI 2026 14英寸 轻薄笔记本电脑 Ultra7 32G',
    base: 1199900,
  },
  {
    keywords: 'Roborock G30',
    title: '石头 Roborock G30 Space 扫地机器人 自动上下水 全能基站',
    base: 449900,
  },
  {
    keywords: 'Q27G4',
    title: 'AOC 27英寸 2K 180Hz Fast IPS 电竞显示器 Q27G4',
    base: 99900,
  },
  {
    keywords: 'EC885',
    title: '德龙 Delonghi EC885 半自动意式咖啡机 家用小型 手动打奶泡',
    base: 249900,
  },
];

/** 各平台的价格系数与店铺名，决定比价差异。 */
const PLATFORM_PROFILE = {
  jd: {
    platformName: '京东',
    multiplier: 1.0,
    shopName: '京东自营旗舰店',
    color: ['#E1251B', '#FF6A4D'],
  },
  taobao: {
    platformName: '淘宝 / 天猫',
    multiplier: 0.973,
    shopName: '天猫官方旗舰店',
    color: ['#FF5000', '#FF9A3C'],
  },
  pdd: {
    platformName: '拼多多',
    multiplier: 0.937,
    shopName: '品牌官方旗舰店（百亿补贴）',
    color: ['#E22E1F', '#FF7A45'],
  },
};

/** 决定「哪家最便宜」的平台顺序：按商品种子轮换，避免演示时永远同一家最低。 */
const WINNER_ORDER = ['jd', 'taobao', 'pdd'];

/**
 * 依次用给定的多段文本匹配原型（关键词、完整标题），都匹配不到再用种子哈希兜底。
 *
 * 为什么要支持多段文本：跨平台「同款匹配」传入的是截断后的搜索关键词（如 30 字），
 * 可能恰好把型号（如 Q27G4）截掉，此时必须回退用完整标题匹配，
 * 否则同一商品在不同平台会落到不同原型上，比价结果完全失真。
 *
 * @param {string} seed
 * @param {...string} texts
 * @returns {{keywords: string, title: string, base: number}}
 */
/**
 * 挑一个演示商品原型。
 *
 * 优先按商品标题 / 关键词命中；都命中不到时按 seed 哈希兜底。
 *
 * ⚠️ 坑：seed 里含 platformId（形如 `jd:100012043978`），若直接拿它做兜底哈希，
 * 同一个商品在京东 / 淘宝 / 拼多多会落到**不同原型**——三家报出完全不同的商品，
 * 于是出现「省 90%」这种荒谬的比价结论。真实主流程靠 title 回退规避了它，
 * 但只要上游标题为空就会复现。因此兜底必须用**与平台无关**的种子。
 *
 * @param {string} seed 与平台无关的商品种子（itemId / keyword / title）
 * @param {...string} texts
 * @returns {{keywords: string, title: string, base: number}}
 */
function pickArchetype(seed, ...texts) {
  for (const text of texts) {
    const value = String(text ?? '');
    if (!value) continue;
    for (const archetype of ARCHETYPES) {
      if (value.includes(archetype.keywords)) return archetype;
    }
  }
  return ARCHETYPES[hashString(seed) % ARCHETYPES.length];
}

/**
 * 生成内联 SVG 占位图（Data URI），零外部依赖、永不裂图。
 * @param {string} platformId
 * @param {string} label
 * @returns {string}
 */
function mockImage(platformId, label) {
  const profile = PLATFORM_PROFILE[platformId] ?? PLATFORM_PROFILE.jd;
  const [from, to] = profile.color;
  const text = String(label ?? '?').slice(0, 2);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>`,
    '</linearGradient></defs>',
    '<rect width="160" height="160" rx="20" fill="url(#g)"/>',
    `<text x="80" y="80" font-size="44" font-weight="700" fill="#ffffff" font-family="sans-serif" text-anchor="middle" dominant-baseline="central">${text}</text>`,
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * 生成各平台的优惠券组合（金额单位为分）。
 *
 * ⚠️ 演示数据的券**没有真实领取链接**（couponUrl 为空），前端据此不渲染
 * 「立即领券」按钮，只显示「去商品页领券」——避免用户以为这里能直接领到券。
 * 各券的命名与门槛形态尽量贴近真实返回，只为让流程跑通、结构一致。
 *
 * @param {string} platformId
 * @param {number} price 当前价（分）
 * @param {string} shopName
 * @param {() => number} rng
 * @returns {Array<object>}
 */
function buildCoupons(platformId, price, shopName, rng) {
  const jitter = 0.9 + rng() * 0.2;

  if (platformId === 'jd') {
    return [
      {
        id: `${platformId}-platform`,
        name: '京东平台满减券',
        amount: roundYuan(price * 0.05 * jitter),
        threshold: roundYuan(price * 0.9),
        expireText: '领取后 7 天内有效',
        source: shopName,
      },
      {
        id: `${platformId}-plus`,
        name: 'PLUS 会员立减',
        amount: roundYuan(price * 0.012 * jitter),
        threshold: 0,
        expireText: '无门槛',
        source: shopName,
      },
    ];
  }

  if (platformId === 'taobao') {
    return [
      {
        id: `${platformId}-shop`,
        name: '天猫店铺券',
        amount: roundYuan(price * 0.045 * jitter),
        threshold: roundYuan(price * 0.85),
        expireText: '领取后 3 天内有效',
        source: shopName,
      },
      {
        id: `${platformId}-coin`,
        name: '淘金币抵扣',
        amount: roundYuan(price * 0.008 * jitter),
        threshold: 0,
        expireText: '无门槛',
        source: shopName,
      },
    ];
  }

  return [
    {
      id: `${platformId}-subsidy`,
      name: '百亿补贴立减',
      amount: roundYuan(price * 0.055 * jitter),
      threshold: 0,
      expireText: '活动期间有效',
      source: shopName,
    },
    {
      id: `${platformId}-shop`,
      name: '店铺满减券',
      amount: roundYuan(price * 0.02 * jitter),
      threshold: roundYuan(price * 0.95),
      expireText: '领取后 3 天内有效',
      source: shopName,
    },
  ];
}

/**
 * 生成一份平台报价（Mock）。
 *
 * @param {object} options
 * @param {string} options.platformId
 * @param {string} [options.itemId]
 * @param {string} [options.keyword]
 * @param {string} [options.title] 覆盖标题（用于跨平台同款匹配）
 * @param {number} [options.basePrice] 覆盖基准价（分）
 * @param {string} [options.url]
 * @param {string} [options.note]
 * @returns {object} ProductQuote
 */
export function buildMockQuote(options) {
  const {
    platformId,
    itemId = '',
    keyword = '',
    title = '',
    basePrice = 0,
    url = '',
    note = '',
  } = options;

  const profile = PLATFORM_PROFILE[platformId] ?? PLATFORM_PROFILE.jd;
  // 与平台无关的「商品身份」种子——原型、价位、谁最便宜都由它决定，
  // 保证同一商品在三家平台是同一件东西、只是价格不同。
  const goodsSeed = itemId || keyword || title || 'default';
  const seed = `${platformId}:${goodsSeed}`;
  const rng = createRng(seed);
  const archetype = pickArchetype(goodsSeed, keyword, title);

  // 让「哪家最便宜」随商品变化，避免演示时永远是同一家最低
  const winnerPlatform =
    WINNER_ORDER[hashString(`winner:${goodsSeed}`) % WINNER_ORDER.length];
  const isWinner = winnerPlatform === platformId;

  const base = basePrice > 0 ? basePrice : archetype.base;
  // 平台系数差异必须收敛在合理区间内：真实电商同款跨平台价差通常 < 20%。
  // 早期实现里 winner 与非 winner 的系数差会叠加放大，出现 3.9x 的荒谬价差，
  // 演示时一眼假。这里把差异压到 ±4% 以内。
  const price = Math.max(
    100,
    roundYuan(base * profile.multiplier * (isWinner ? 0.975 : 1.015) * (0.995 + rng() * 0.01)),
  );
  const shopName = profile.shopName;

  const couponScale = isWinner ? 1.4 : 0.85;
  const coupons = buildCoupons(platformId, price, shopName, rng)
    .map((coupon) => ({
      ...coupon,
      amount: Math.min(price, Math.max(100, roundYuan(coupon.amount * couponScale))),
      threshold: Math.min(coupon.threshold, price),
    }));

  // 跨平台搜索命中的商品没有真实 ID，这里按种子生成一个稳定的伪 ID，
  // 保证本地价格库能为它归档（同一关键词每次得到同一个 ID）。
  const resolvedItemId =
    itemId || String(100000000 + (hashString(`itemid:${seed}`) % 899999999));

  return buildQuote({
    platformId,
    itemId: resolvedItemId,
    platformName: profile.platformName,
    title: title || archetype.title,
    shopName,
    imageUrl: mockImage(platformId, archetype.keywords),
    price,
    coupons,
    url: url || '',
    isMock: true,
    note,
  });
}

/**
 * 生成历史价格序列（Mock）：近 180 天，含日常波动与两次大促深跌。
 *
 * @param {object} options
 * @param {string} options.seed
 * @param {number} options.currentPrice 当前价（分），序列最后一天对齐该值
 * @param {number} [options.days]
 * @returns {object} HistoryData
 */
export function buildMockHistory(options) {
  const { seed, currentPrice, keyword = '', title = '', days = 180 } = options;

  // 未给出当前价时（如仅按关键词查询），用演示商品的基准价兜底，避免得到无意义的金额。
  const fallbackPrice = buildMockQuote({
    platformId: 'jd',
    itemId: seed,
    keyword: keyword || title,
  }).price;
  const current = Math.max(1, Math.round(currentPrice > 0 ? currentPrice : fallbackPrice));

  const rng = createRng(`history:${seed}`);

  // 四种价格形态，让「当前价低于 X% 的时间」这一结论有真实差异，而不是恒定 98%
  const regime = Math.floor(rng() * 4);
  const start = Math.max(
    current + 100,
    Math.round(current * [1.28, 1.32, 0.92, 0.94][regime] * (0.97 + rng() * 0.08)),
  );

  const dipA = Math.floor(days * (0.26 + rng() * 0.08));
  const dipB = Math.floor(days * (0.62 + rng() * 0.12));

  /** 促销窗口内价格打到 84 折。 */
  const dipFactor = (index, center) => (Math.abs(index - center) <= 2 ? 0.84 : 1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const points = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(today.getTime() - (days - 1 - i) * 86400000);
    const progress = i / (days - 1);

    let trend;
    if (regime === 0) {
      // 持续走低：当前价接近历史最低
      trend = start + (current - start) * progress ** 1.4;
    } else if (regime === 1) {
      // 探底回升：中途跌到最低点，近期反弹回当前价
      const low = Math.round(current * 0.88);
      const pivot = 0.82;
      trend =
        progress <= pivot
          ? start + (low - start) * (progress / pivot) ** 1.15
          : low + (current - low) * ((progress - pivot) / (1 - pivot));
    } else if (regime === 2) {
      // 冲高回落：中途冲到高点后一路降到现在
      const peak = Math.round(current * 1.3);
      const pivot = 0.35;
      trend =
        progress <= pivot
          ? start + (peak - start) * (progress / pivot) ** 0.8
          : peak + (current - peak) * ((progress - pivot) / (1 - pivot)) ** 1.1;
    } else {
      // 低位横盘后微涨：当前价高于大部分历史价格
      trend = start + (current - start) * progress ** 1.1;
    }

    const noise = (rng() - 0.5) * Math.max(start, current) * 0.035;
    const value = (trend + noise) * dipFactor(i, dipA) * dipFactor(i, dipB);
    points.push({
      date: toLocalDateStr(date),
      price: Math.max(1, Math.round(value / 100) * 100),
    });
  }

  // 最后一天对齐当前价，避免图表终点与结论卡数字不一致。
  points[points.length - 1] = {
    date: toLocalDateStr(today),
    price: current,
  };

  return finalizeHistory({ points, current, isMock: true, rangeDays: days });
}

/**
 * 把价格点数组整理成前端所需的 HistoryData（含统计与结论文案）。
 *
 * @param {object} input
 * @param {Array<{date: string, price: number}>} input.points
 * @param {number} input.current 当前价（分）
 * @param {boolean} input.isMock
 * @param {number} input.rangeDays
 * @returns {object} HistoryData
 */
export function finalizeHistory(input) {
  const points = (input.points ?? []).filter((point) => point && point.date && Number(point.price) > 0);
  if (points.length === 0) {
    return {
      isMock: Boolean(input.isMock),
      rangeDays: input.rangeDays ?? 0,
      points: [],
      current: input.current ?? 0,
      max: 0,
      min: 0,
      avg: 0,
      maxDate: '',
      minDate: '',
      percentile: 0,
      changeFromMax: 0,
      changeFromAvg: 0,
      insights: ['暂无历史价格数据'],
    };
  }

  const prices = points.map((point) => point.price);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const avg = Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length);
  const current = input.current ?? prices[prices.length - 1];

  const maxPoint = points.find((point) => point.price === max) ?? points[0];
  const minPoint = points.find((point) => point.price === min) ?? points[0];

  // 当前价低于多少比例的时间（严格高于当前价的天数占比）
  const cheaper = prices.filter((price) => price > current).length;
  const percentile = Math.round((cheaper / prices.length) * 100);

  const yuan = (cents) => (cents / 100).toFixed(2);
  const insights = [];
  insights.push(`当前价 ¥${yuan(current)} 低于近 ${points.length} 天中 ${percentile}% 的时间`);
  insights.push(
    current > min
      ? `历史最低 ¥${yuan(min)}（${minPoint.date}），比现价低 ¥${yuan(current - min)}`
      : `当前价 ¥${yuan(current)} 已是近 ${points.length} 天最低`,
  );
  insights.push(`历史最高 ¥${yuan(max)}（${maxPoint.date}），近 ${points.length} 天均价 ¥${yuan(avg)}`);

  return {
    isMock: Boolean(input.isMock),
    rangeDays: input.rangeDays ?? points.length,
    points,
    current,
    max,
    min,
    avg,
    maxDate: maxPoint.date,
    minDate: minPoint.date,
    percentile,
    changeFromMax: current - max,
    changeFromAvg: current - avg,
    insights,
  };
}
