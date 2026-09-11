import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 注意：Vite 不会把 .env 里的变量注入 process.env，
 * 因此这里用 loadEnv 显式读取 PORT，保证代理端口与后端实际监听端口一致。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = Number(env.PORT ?? 8787);

  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      strictPort: false,
      proxy: {
        // 与线上（EdgeOne Makers Cloud Functions）行为对齐：
        // 平台会把 cloud-functions/api/ 这个目录名当作路由前缀，并在转发给
        // Express **之前剥掉** `/api`（官方示例：app.get('/') 对应访问 GET /api/）。
        // 因此这里也用 rewrite 去掉 `/api`，让本地后端收到与线上完全一致的路径。
        // 这样 server/app.js 里只需把路由挂在根路径，两份环境共用一套代码。
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    preview: {
      port: 4173,
      host: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
    },
  };
});
