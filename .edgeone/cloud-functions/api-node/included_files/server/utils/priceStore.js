import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore as getPagesBlobStore } from '@edgeone/pages-blob';

/**
 * 自建历史价格库（双后端：Blob 优先，本地文件降级）。
 *
 * 为什么需要：第三方历史价数据源（大淘客 / 慢慢买类）都可能有门槛或不可用，
 * 而「历史价格」是本工具的核心卖点之一。自建库把每次 /api/compare 的观测结果落盘，
 * 随着使用自然累积出**真实**的价格曲线——不依赖任何第三方、不编造数据。
 *
 * 为什么是双后端：
 *  - 部署到 EdgeOne Makers 的 Cloud Functions 后，**本地文件系统不可持久化**
 *    （每次冷启动容器都可能是全新的，写进 server/data/ 的数据会丢），
 *    所以线上必须用平台 Blob 对象存储；
 *  - 但本地 `npm run dev` / `npm start` 时没有 Blob 运行环境，且开发者希望
 *    数据落在看得见的文件里，所以保留原有的本地文件读写作为降级路径。
 *
 * 选择策略：Blob 优先，失败（未绑定 / 未安装 SDK / 调用抛错）自动回退本地文件。
 * 两边都在 try/catch 内，任何一侧故障都不会让比价主流程崩掉。
 *
 * 实现约束：
 *  - 复用 fs + JSON 的原有语义，不引入 SQLite 等外部依赖；
 *  - 写入串行化（Promise 队列）避免并发「读-改-写」互相覆盖；
 *    （本地文件额外用临时文件原子 rename；Blob 无原子 rename，靠队列串行化保证）
 *  - 读取无锁，因为同一进程内写是串行的。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'price-history.json');
const TMP_FILE = `${DATA_FILE}.tmp`;

/** 单个商品最多保留的价格点数（约 5 年多的日频数据）。 */
const MAX_POINTS_PER_ITEM = 2000;
/** 整个库最多保留的商品条目数，超出后按插入顺序淘汰最旧的。 */
const MAX_ITEMS = 5000;

/** Blob 命名空间名（部署时自动创建，无需手工建）。 */
const BLOB_STORE_NAME = 'price-hunter';
/** Blob 内单个 JSON 对象的 key。 */
const BLOB_OBJECT_KEY = 'price-history.json';

/** 写操作串行队列：所有变更都排在这条链上执行。 */
let writeQueue = Promise.resolve();

/**
 * Blob 运行环境探测结果缓存。
 *   undefined = 还没探测过
 *   null      = 探测过，不可用（后续一律走本地文件，避免反复 import/try-catch 开销）
 *   object    = 可用的 Store 实例
 */
let blobStore;

/**
 * 环境变量读取。
 *
 * 为什么同时看两处：本地 `node server/index.js` 走 dotenv → process.env；
 * 而平台约定 Cloud Functions 内通过 `context.env` 拿环境变量（Node 运行时下
 * 平台会把 context.env 注入 process.env，但为了不依赖该实现细节，
 * 这里额外支持 globalThis.__EO_ENV__ —— 由 Cloud Function 入口在收到 context 时写入）。
 * process.env 优先，因为它能同时覆盖本地与已注入的线上场景。
 *
 * @param {string} name
 * @returns {string}
 */
function readEnv(name) {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== null) return String(fromProcess);
  const fromGlobal = globalThis.__EO_ENV__?.[name];
  if (fromGlobal !== undefined && fromGlobal !== null) return String(fromGlobal);
  return '';
}

/**
 * 暂存平台注入的环境变量（幂等）。
 *
 * 使用场景：若后续把 Cloud Function 入口改回「导出 onRequest」的 Handler 模式，
 * 可在收到 context 时调用本函数，把 context.env 喂给下游读取逻辑。
 * 当前入口为平台推荐的框架模式（裸 `export default app`），平台侧负责注入
 * process.env，故本函数暂未被主流程调用，仅供扩展保留。
 *
 * @param {Record<string, any>|undefined|null} env
 * @returns {void}
 */
export function applyRuntimeEnv(env) {
  if (env && typeof env === 'object') {
    globalThis.__EO_ENV__ = { ...(globalThis.__EO_ENV__ ?? {}), ...env };
  }
}

/**
 * 本地价格库是否启用（默认启用，LOCAL_HISTORY_ENABLED=false 可关）。
 * @returns {boolean}
 */
export function isEnabled() {
  const raw = readEnv('LOCAL_HISTORY_ENABLED').trim().toLowerCase() || 'true';
  return raw !== 'false' && raw !== '0' && raw !== 'off' && raw !== 'no';
}

/**
 * 库内条目的键名。
 * @param {string} platformId
 * @param {string} itemId
 * @returns {string}
 */
export function keyOf(platformId, itemId) {
  return `${platformId}:${itemId}`;
}

/**
 * 惰性探测并获取 Blob Store；不可用时缓存 null 并降级到本地文件。
 *
 * 为什么用静态 import 而不是 `await import('@edgeone/pages-blob')`：
 *   平台的 Cloud Functions 构建器会**静态扫描并改写 import 路径**
 *   （把依赖路径替换为平台内部路径）。它对动态 import 会直接报
 *   `Property source of ImportDeclaration expected node to be of a type ["StringLiteral"]`
 *   并跳过改写，导致线上 `@edgeone/pages-blob` 解析失败。
 *   静态 import 才能在构建期被正确处理。
 *
 * 为什么不在模块顶层直接 getStore()：
 *   本地 `npm run dev` 时没有 PAGES_BLOB_DEPLOY_CREDENTIAL 环境变量，
 *   getStore() 会抛 MISSING_ENVIRONMENT。故仍保持「惰性 + try/catch」，
 *   首次真正需要读写时才创建，失败即降级到本地文件。
 *
 * @returns {Promise<any|null>} Store 实例或 null
 */
async function getBlobStore() {
  if (blobStore !== undefined) return blobStore;

  try {
    // strong 一致性：价格曲线是「写后立刻要读」的场景
    // （本次 compare 写入后马上要作为历史曲线读出来），eventual 的秒级延迟会让
    // 本次观测在响应里缺失，故显式要求强一致。
    blobStore = getPagesBlobStore({ name: BLOB_STORE_NAME, consistency: 'strong' });
  } catch {
    // 不在 Cloud Functions 运行环境（本地开发）——属于预期内的降级场景
    blobStore = null;
  }

  return blobStore;
}

/**
 * 校验并归一化数据库结构：任何异常形态都退化成空库，绝不抛异常。
 * @param {unknown} parsed
 * @returns {{version: number, updatedAt: string, items: Record<string, any>}}
 */
function normalizeDatabase(parsed) {
  if (!parsed || typeof parsed !== 'object' || !parsed.items || typeof parsed.items !== 'object') {
    return { version: 1, updatedAt: '', items: {} };
  }
  return /** @type {{version: number, updatedAt: string, items: Record<string, any>}} */ (parsed);
}

/**
 * 从 Blob 读取整个库；不可用或内容损坏时返回空库。
 * @returns {Promise<{version: number, updatedAt: string, items: Record<string, any>}|null>}
 *   null 表示「Blob 后端不可用」，交由调用方决定是否降级
 */
async function readFromBlob() {
  const store = await getBlobStore();
  if (!store) return null;

  try {
    // get({type:'json'}) 在 key 不存在时返回 null
    const data = await store.get(BLOB_OBJECT_KEY, { type: 'json', consistency: 'strong' });
    return normalizeDatabase(data);
  } catch {
    // 读取失败视为 Blob 不可用 —— 可能是运行时没有绑定 Blob，交给本地文件兜底
    return null;
  }
}

/**
 * 把整个库写入 Blob。
 * @param {{items: Record<string, any>}} database
 * @returns {Promise<boolean>} 是否成功写入 Blob
 */
async function writeToBlob(database) {
  const store = await getBlobStore();
  if (!store) return false;

  try {
    await store.setJSON(BLOB_OBJECT_KEY, {
      version: 1,
      updatedAt: new Date().toISOString(),
      items: database.items ?? {},
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取整个库（Blob 优先，本地文件降级）；内容损坏时返回空库，绝不抛异常。
 * @returns {Promise<{version: number, updatedAt: string, items: Record<string, any>}>}
 */
async function readDatabase() {
  const fromBlob = await readFromBlob();
  if (fromBlob) return fromBlob;

  // 降级：本地文件（本地开发 / Blob 未绑定）
  try {
    const text = await fs.readFile(DATA_FILE, 'utf8');
    return normalizeDatabase(JSON.parse(text));
  } catch {
    return { version: 1, updatedAt: '', items: {} };
  }
}

/**
 * 写回整个库（Blob 优先，本地文件降级）——两侧都尝试，保证部署环境与本地开发都能落盘。
 * @param {{items: Record<string, any>}} database
 * @returns {Promise<void>}
 */
async function writeDatabase(database) {
  await writeToBlob(database);
  await writeToLocalFile(database);
}

/**
 * 本地文件写回（先写临时文件再原子 rename，避免读到半截 JSON）。
 * @param {{items: Record<string, any>}} database
 * @returns {Promise<void>}
 */
async function writeToLocalFile(database) {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const payload = JSON.stringify(
      { version: 1, updatedAt: new Date().toISOString(), items: database.items ?? {} },
      null,
      2,
    );
    await fs.writeFile(TMP_FILE, payload, 'utf8');
    await fs.rename(TMP_FILE, DATA_FILE);
  } catch {
    // 只读文件系统（Cloud Functions 部署环境）会走到这里——不影响主流程
  }
}

/**
 * 把所有写操作串到同一条 Promise 链上，保证同一时刻只有一个写事务。
 * @param {() => Promise<any>} task
 * @returns {Promise<any>}
 */
function withWriteLock(task) {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 记录一次价格观测。
 *
 * 同一时间戳（精确到毫秒）的观测会被覆盖而不是重复追加，
 * 这样同一秒内重复请求不会产生脏点，而间隔开的请求会各自成点。
 *
 * @param {Array<{platformId: string, itemId: string, title?: string, price: number, finalPrice?: number}>} observations
 * @returns {Promise<number>} 实际写入的条数
 */
export function recordObservations(observations) {
  const list = (observations ?? []).filter(
    (item) => item && item.platformId && item.itemId && Number(item.price) > 0,
  );

  if (!isEnabled() || list.length === 0) return Promise.resolve(0);

  const timestamp = new Date().toISOString();
  const date = timestamp.slice(0, 10);

  return withWriteLock(async () => {
    const database = await readDatabase();

    for (const observation of list) {
      const key = keyOf(observation.platformId, observation.itemId);
      const entry = database.items[key] ?? {
        platformId: observation.platformId,
        itemId: observation.itemId,
        title: '',
        points: [],
      };

      entry.platformId = observation.platformId;
      entry.itemId = observation.itemId;
      if (observation.title) entry.title = observation.title;
      if (!Array.isArray(entry.points)) entry.points = [];

      const point = {
        t: timestamp,
        date,
        price: Math.round(Number(observation.price)),
        finalPrice: Math.round(Number(observation.finalPrice ?? observation.price)),
      };

      const index = entry.points.findIndex((existing) => existing && existing.t === timestamp);
      if (index >= 0) {
        entry.points[index] = point;
      } else {
        entry.points.push(point);
      }

      if (entry.points.length > MAX_POINTS_PER_ITEM) {
        entry.points = entry.points.slice(-MAX_POINTS_PER_ITEM);
      }

      entry.updatedAt = timestamp;
      database.items[key] = entry;
    }

    const keys = Object.keys(database.items);
    if (keys.length > MAX_ITEMS) {
      for (const staleKey of keys.slice(0, keys.length - MAX_ITEMS)) {
        delete database.items[staleKey];
      }
    }

    await writeDatabase(database);
    return list.length;
  });
}

/**
 * 读取某个商品的价格序列（按时间升序），价格取「券后到手价」。
 * @param {string} platformId
 * @param {string} itemId
 * @returns {Promise<Array<{date: string, price: number}>>}
 */
export async function getSeries(platformId, itemId) {
  if (!platformId || !itemId) return [];

  const database = await readDatabase();
  const entry = database.items[keyOf(platformId, itemId)];
  if (!entry || !Array.isArray(entry.points)) return [];

  return entry.points
    .filter((point) => point && point.date && Number(point.finalPrice ?? point.price) > 0)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0))
    .map((point) => ({
      date: String(point.date),
      price: Math.round(Number(point.finalPrice ?? point.price)),
    }));
}

/**
 * 该商品已记录了多少个**不同日期**（用于前端展示「已记录 N 天」）。
 * @param {string} platformId
 * @param {string} itemId
 * @returns {Promise<number>}
 */
export async function getRecordedDays(platformId, itemId) {
  const points = await getSeries(platformId, itemId);
  return new Set(points.map((point) => point.date)).size;
}

export default { isEnabled, recordObservations, getSeries, getRecordedDays, keyOf };
