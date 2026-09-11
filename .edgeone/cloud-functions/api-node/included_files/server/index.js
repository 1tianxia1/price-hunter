import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

import app from './app.js';

/**
 * 本地开发 / 传统单进程部署入口。
 *
 * Express app 的构建逻辑已抽到 server/app.js，本文件只负责：
 *   1) 加载 .env；
 *   2) app.listen 起监听并打印启动横幅。
 *
 * 部署到 EdgeOne Makers 时**不会**执行本文件 —— 平台会用
 * cloud-functions/express/[[default]].js 里的 `export default app` 接管请求。
 * 因此这里的 listen 行为可以放心保留，npm run dev / npm start 照常工作。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

// 依次加载根目录 .env 与 server/.env；已存在的环境变量优先，不被覆盖。
dotenv.config({ path: path.join(rootDir, '.env') });
dotenv.config({ path: path.join(here, '.env') });

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

app.listen(PORT, HOST, () => {
  const configured = [
    ['京东联盟', process.env.JD_APP_KEY && process.env.JD_APP_SECRET],
    ['淘宝客', process.env.TAOBAO_APP_KEY && process.env.TAOBAO_APP_SECRET],
    ['多多进宝', process.env.PDD_CLIENT_ID && process.env.PDD_CLIENT_SECRET],
    ['历史价', process.env.HISTORY_API_BASE_URL && process.env.HISTORY_API_KEY],
  ];

  console.log('');
  console.log(`  PriceHunter API 已启动  ->  http://127.0.0.1:${PORT}`);
  console.log('  数据源配置状态：');
  for (const [name, ok] of configured) {
    console.log(`    - ${name}：${ok ? '已配置 Key，使用真实数据' : '未配置 Key，使用演示数据(Mock)'}`);
  }
  console.log('');
});
