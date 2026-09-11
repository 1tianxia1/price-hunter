import { ApiError } from './errors.js';

/**
 * 链接 / 分享文案解析层：
 *  - 从「带中文的分享文本」里挖出真实链接
 *  - 识别平台（京东 / 淘宝天猫 / 拼多多）
 *  - 提取商品 ID
 *
 * 各平台 Adapter 的 parseUrl 也复用这里的规则，保证「识别」与「取 ID」永远一致。
 */

/** 已知电商域名（用于从无 scheme 的文本里捞链接）。 */
const KNOWN_HOST_PATTERN =
  /(?:[a-z0-9-]+\.)*(?:jd\.com|jd\.hk|taobao\.com|tmall\.com|tmall\.hk|yangkeduo\.com|pinduoduo\.com|tb\.cn)(?:\/[^\s"'<>《》\u4e00-\u9fff]*)?/i;

/** 结尾常见的中英文标点，需要在提取后裁掉。 */
const TRAILING_PUNCTUATION = /[，。；！？、,.;!?:：)\]}>》"'「」]+$/;

/**
 * 平台规则表：hosts 决定归属平台，patterns 按顺序尝试提取商品 ID。
 */
const PLATFORM_RULES = [
  {
    platformId: 'jd',
    label: '京东',
    hosts: [/(?:^|\.)jd\.com$/i, /(?:^|\.)jd\.hk$/i],
    patterns: [
      /item\.jd\.(?:com|hk)\/(\d{6,20})/i,
      /item\.m\.jd\.com\/product\/(\d{6,20})/i,
      /(?:^|[?&])sku=(\d{6,20})/i,
      /(?:^|[?&])wareId=(\d{6,20})/i,
      /\/product\/(\d{6,20})/i,
    ],
  },
  {
    platformId: 'taobao',
    label: '淘宝 / 天猫',
    hosts: [
      /(?:^|\.)taobao\.com$/i,
      /(?:^|\.)tmall\.com$/i,
      /(?:^|\.)tmall\.hk$/i,
      /(?:^|\.)tb\.cn$/i,
    ],
    patterns: [
      /a\.m\.(?:taobao|tmall)\.com\/i(\d{8,20})\.htm/i,
      /(?:^|[?&])id=(\d{8,20})/i,
      /(?:^|[?&])item_id=(\d{8,20})/i,
      /(?:^|[?&])itemId=(\d{8,20})/i,
      /\/i(\d{8,20})\.htm/i,
    ],
  },
  {
    platformId: 'pdd',
    label: '拼多多',
    hosts: [/(?:^|\.)yangkeduo\.com$/i, /(?:^|\.)pinduoduo\.com$/i],
    patterns: [
      /(?:^|[?&])goods_id=(\d{6,25})/i,
      /(?:^|[?&])goodsId=(\d{6,25})/i,
      /\/goods\d*\.html\?[^\s]*?goods_id=(\d{6,25})/i,
    ],
  },
];

/**
 * 从一段可能带中文 / emoji / 口令的分享文本里挖出链接。
 * @param {string} input
 * @returns {string|null}
 */
export function extractUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  const withScheme = raw.match(/https?:\/\/[^\s"'<>\u4e00-\u9fff]+/i);
  if (withScheme) {
    return withScheme[0].replace(TRAILING_PUNCTUATION, '');
  }

  const bare = raw.match(KNOWN_HOST_PATTERN);
  if (bare) {
    return `https://${bare[0].replace(TRAILING_PUNCTUATION, '')}`;
  }

  return null;
}

/**
 * 规范化 URL：解码 HTML 实体、补齐协议、去掉 fragment。
 * @param {string} url
 * @returns {string}
 */
export function normalizeUrl(url) {
  let value = String(url ?? '').trim();
  if (!value) return value;

  value = value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();

  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value.replace(/^\/+/, '')}`;
  }

  return value.split('#')[0];
}

/**
 * 取 hostname，失败时退化成小写原串。
 * @param {string} url
 * @returns {string}
 */
function safeHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

/**
 * 按平台规则提取商品 ID。
 * @param {{patterns: RegExp[]}} rule
 * @param {string} url
 * @returns {string|null}
 */
function matchItemId(rule, url) {
  for (const pattern of rule.patterns) {
    const found = url.match(pattern);
    if (found && found[1]) return found[1];
  }
  return null;
}

/**
 * 识别输入属于哪个平台并提取商品 ID。
 *
 * @param {string} input 用户粘贴的链接或分享文案
 * @returns {{ platformId: string, platformName: string, itemId: string, url: string }}
 * @throws {ApiError} 无法识别时抛出 400
 */
export function detectPlatform(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    throw new ApiError(400, '请先粘贴商品链接，再点击「比价找券」');
  }

  const extracted = extractUrl(raw);
  if (!extracted) {
    throw new ApiError(400, '未能识别的链接，请检查是否复制完整');
  }

  const url = normalizeUrl(extracted);
  const host = safeHost(url);

  for (const rule of PLATFORM_RULES) {
    const isHostMatched = rule.hosts.some((regex) => regex.test(host));
    if (!isHostMatched) continue;

    const itemId = matchItemId(rule, url);
    if (itemId) {
      return {
        platformId: rule.platformId,
        platformName: rule.label,
        itemId,
        url,
      };
    }

    // 域名认出来了，但短链里没有商品 ID —— 给可行动的建议，而不是笼统报错。
    throw new ApiError(
      400,
      `识别到${rule.label}链接，但未能提取商品 ID。短链无法解析，请在浏览器中打开该商品后，复制地址栏的完整链接`,
    );
  }

  throw new ApiError(400, '未能识别的链接，目前支持京东 / 淘宝 / 天猫 / 拼多多的商品链接，请检查是否复制完整');
}

/**
 * 从分享文案里提取商品标题（淘宝/京东口令的「标题」形态）。
 * @param {string} input
 * @returns {string} 提取不到返回空串
 */
export function extractShareTitle(input) {
  const raw = String(input ?? '');
  const matches = [
    ...raw.matchAll(/[「『]([^「」『』]{4,80})[」』]/g),
    ...raw.matchAll(/【([^【】]{4,80})】/g),
  ];
  for (const match of matches) {
    const title = (match[1] ?? '').trim();
    // 过滤纯符号 / 过短噪声（如「尝新装」这类活动前缀单独出现时）
    if (title.length >= 6 && /[\u4e00-\u9fffA-Za-z0-9]/.test(title)) {
      return title;
    }
  }
  return '';
}

/** 文本形态的平台线索（短链口令里通常带平台名，如「【淘宝】https://e.tb.cn/...」）。 */
const PLATFORM_TEXT_HINTS = [
  { platformId: 'taobao', label: '淘宝 / 天猫', re: /(淘宝|天猫|taobao|tmall|tb\.cn)/i },
  { platformId: 'jd', label: '京东', re: /(京东|jd\.com|jd\.hk)/i },
  { platformId: 'pdd', label: '拼多多', re: /(拼多多|yangkeduo|pdd|pinduoduo)/i },
];

/**
 * 统一输入解析入口（比 compare / parse 路由专用）。
 *
 * 两种模式：
 *   - mode 'itemId' ：完整商品链接，可提取商品 ID，走商品详情查询
 *   - mode 'keyword'：短链 / 纯口令文本，无法解出 ID，但文案里带商品标题
 *                     → 用标题当关键词走「同款搜索」比价
 *
 * @param {string} input
 * @returns {{ platformId: string, platformName: string, itemId: string, url: string,
 *             mode: 'itemId'|'keyword', keyword?: string }}
 * @throws {ApiError} 完全无法识别时抛出 400
 */
export function resolveInput(input) {
  const raw = String(input ?? '').trim();
  if (!raw) {
    throw new ApiError(400, '请先粘贴商品链接，再点击「比价找券」');
  }

  try {
    const parsed = detectPlatform(raw);
    return { ...parsed, mode: 'itemId' };
  } catch (err) {
    // 短链 / 纯口令文本：识别不出商品 ID，但标题 + 平台词足够走关键词比价
    const title = extractShareTitle(raw);
    if (!title) throw err;

    const hint = PLATFORM_TEXT_HINTS.find((item) => item.re.test(raw));
    if (!hint) throw err;

    return {
      platformId: hint.platformId,
      platformName: hint.label,
      itemId: '',
      url: extractUrl(raw) ?? '',
      keyword: title,
      mode: 'keyword',
    };
  }
}

/**
 * 供 Adapter 复用的「按平台提取商品 ID」。
 * @param {string} platformId
 * @param {string} url
 * @returns {string|null}
 */
export function extractItemId(platformId, url) {
  const rule = PLATFORM_RULES.find((item) => item.platformId === platformId);
  if (!rule) return null;
  try {
    return matchItemId(rule, normalizeUrl(url));
  } catch {
    return null;
  }
}

/**
 * 生成原链接之外其它平台的商品搜索页链接（用于「去其它平台看看」）。
 * @param {string} platformId
 * @param {string} keyword
 * @returns {string}
 */
export function buildSearchUrl(platformId, keyword) {
  const query = encodeURIComponent(keyword || '');
  switch (platformId) {
    case 'jd':
      return `https://search.jd.com/Search?keyword=${query}`;
    case 'taobao':
      return `https://s.taobao.com/search?q=${query}`;
    case 'pdd':
      return `https://mobile.yangkeduo.com/search_result.html?search_key=${query}`;
    default:
      return `https://www.baidu.com/s?wd=${query}`;
  }
}

/**
 * 从商品标题里提炼用于跨平台「同款匹配」的关键词。
 * 去掉促销括号内容、渠道词，取前若干个有效词。
 *
 * @param {string} title
 * @param {number} [maxLength]
 * @returns {string}
 */
export function buildSearchKeyword(title, maxLength = 40) {
  const cleaned = String(title ?? '')
    .replace(/[【\[（(][^】\]）)]*[】\]）)]/g, ' ')
    .replace(/(包邮|正品|官方|旗舰店|自营|现货|秒发|限时|特价|秒杀|百亿补贴|国行)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return '';

  const tokens = cleaned.split(' ').filter(Boolean);
  let keyword = '';
  for (const token of tokens) {
    const next = keyword ? `${keyword} ${token}` : token;
    if (next.length > maxLength) break;
    keyword = next;
  }

  return keyword || cleaned.slice(0, maxLength);
}
