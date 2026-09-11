import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

import compareRouter from './routes/compare.js';
import { ApiError, toApiError } from './utils/errors.js';

/**
 * PriceHunter 后端：签名代理 + 数据聚合层。
 * 密钥只存在于服务端进程内，前端永远拿不到。
 *
 * 本模块只负责**构建并导出 Express app 实例**，不监听端口——
 * 这样同一个 app 既能被本地 `node server/index.js` 用 app.listen 起服务，
 * 也能被 EdgeOne Makers 的 Cloud Function 入口（cloud-functions/express/[[default]].js）
 * 直接 `export default app` 复用。路由/中间件只维护一份，避免本地与线上行为漂移。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

const app = express();

app.use(cors());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

/**
 * API 路由挂载在**根路径**，不是 `/api`。
 *
 * 平台行为（官方文档明确）：Cloud Functions 的文件路径即路由前缀，
 * `cloud-functions/api/[[default]].js` 对应线上 `example.com/api/*`，
 * 且平台会**先剥掉该前缀再把请求交给框架**。官方示例写得很直白：
 *   文件 `cloud-functions/api/[[default]].js` 里 `app.get('/')` → 访问 `GET /api/`
 * 所以 Express 里必须挂根路径，`/api` 由平台补上。
 *
 * 本地 `npm run dev` 如何对齐：Vite 代理配置里用 rewrite 把 `/api` 前缀去掉
 * 再转发给后端（见 vite.config.ts），后端行为与线上完全一致——
 * 同一份路由代码，无需任何环境判断。
 */
app.use(compareRouter);

// 生产模式下顺便托管前端构建产物（npm run build 后可直接 node server/index.js）
//
// 适配说明：Makers 平台上前端产物由静态资源层优先伺服（且静态资源优先于函数路由），
// 一般不会走到这里；保留该逻辑可让「单进程自托管」的部署方式同样开箱可用。
const distDir = path.join(rootDir, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA 兜底：把非 API 的未知路径交回 index.html 由前端路由接管。
  // Makers 上静态层已处理该逻辑，这里保留不会冲突（/api/* 已在上面被路由消化）。
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

/** 未命中的 API 路由返回结构化 JSON 而不是 HTML 404。 */
app.use('/api', (_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: '接口不存在，请检查请求路径' },
  });
});

/** 统一错误处理：把任意异常翻译成可展示的中文提示。 */
app.use((err, _req, res, _next) => {
  const known = err instanceof SyntaxError && 'body' in err
    ? new ApiError(400, '请求体不是合法 JSON')
    : toApiError(err);

  if (known.status >= 500) {
    console.error('[api] 服务端异常：', err);
  }

  res.status(known.status).json({
    success: false,
    error: {
      code: known.status === 400 ? 'BAD_REQUEST' : known.status === 404 ? 'NOT_FOUND' : 'UPSTREAM_ERROR',
      message: known.message,
    },
  });
});

export { rootDir };
export default app;
