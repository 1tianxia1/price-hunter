import app from '../../server/app.js';

/**
 * EdgeOne Makers Cloud Function（Node.js 运行时）入口 —— Express「框架模式」。
 *
 * 为什么是「导出 app 实例」而不是「导出 onRequest 包一层」：
 *   平台约定框架模式必须把该框架的全部路由集中在一个 `[[...]]` 命名的函数文件里，
 *   并 `export default` **框架实例**，由平台内置完成 web Request → Node req/res 的适配。
 *   官方文档原文：「无需额外启动 HTTP Server 与设置端口监听」「必须导出框架实例
 *   否则构建器不会将其识别为函数」，且所有官方 Express/Koa 示例都是裸 `export default app`。
 *
 *   ⚠️ 实测教训：不要写成 `export default async (context) => app(context.request)`。
 *   Express 是 Node 风格框架，内部会改写 `req.url` 等属性，而 web 标准 `Request`
 *   上的 `url` 只有 getter，赋值即抛
 *   `TypeError: Cannot set property url of #<_Request> which has only a getter`。
 *   把 Express 实例直接交给平台，才能走平台既有的 Node 适配层。
 *
 * 为什么目录名是 `api`：
 *   平台**把目录名当作路由前缀**——本文件挂在 `/api/*` 下。
 *   前端 src/api.ts 调用的是 `/api/parse`、`/api/compare`、`/api/history`，
 *   因此目录名必须是 `api` 才能命中（曾用 `express` 作目录名，
 *   导致路由挂在 /express/* 而 /api/* 返回 502 Bad Gateway）。
 *
 * 为什么文件名是 [[default]].js：
 *   平台按「静态 > [param] 单级 > [[param]] 多级」的顺序匹配路由。用多级通配
 *   `[[default]]`（而不是单级 `[default]`）才能同时兜住 `/api`、`/api/parse`
 *   以及未来可能的更深层级路径。
 *
 * 静态托管：平台「静态资源优先于函数路由」且前端产物由静态资源层伺服，
 * 因此 /api/* 必定进入本函数；server/app.js 中保留的 express.static 仅对
 * 「单进程自托管」场景生效。
 */
export default app;
