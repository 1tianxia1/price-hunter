# PriceHunter · 全网购物比价找券 + 历史价格查询

粘贴一条商品链接，一键对比 **京东 / 淘宝天猫 / 拼多多** 的当前价、可用优惠券与券后价，
并查看近 180 天历史价格走势，直接给出「全网最低价」结论。

> **没有 API Key 也能完整跑通**：所有数据源内置降级机制，检测不到 `.env` 中的密钥时自动返回
> 与真实结构完全一致的演示数据（Mock），页面顶部会显示醒目提示横幅。拿到 Key 后填入 `.env`
> 刷新页面即切换为真实数据，**无需改动任何代码**。

---

## 一、三步使用

1. 在电商 App / 网页复制商品链接（支持带中文口令的分享文案）
2. 粘贴到本工具输入框 —— **粘贴即自动识别**平台与商品 ID
3. 点击「比价找券」→ 输出各平台价格对比 + 可用优惠券 + 历史价格曲线 + 全网最低价结论

---

## 二、快速开始

### 环境要求

- Node.js >= 18.18（推荐 22.x，已内置 `fetch`）

### 安装与启动

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://127.0.0.1:8787
- Vite 已配置代理：`/api` → `http://127.0.0.1:8787`

一条 `npm run dev` 通过 `concurrently` 同时拉起前后端。

### 其它命令

```bash
npm run dev:web     # 只起前端
npm run dev:api     # 只起后端
npm run build       # tsc 类型检查 + 前端生产构建（输出到 dist/）
npm run preview     # 预览构建产物
npm start           # 仅启动后端（若已 build，会同时托管 dist/ 静态资源）
```

### 冒烟验证

```bash
# 健康检查
curl http://127.0.0.1:8787/api/health

# 比价主流程（未配 Key 时返回 Mock，isMock=true）
curl http://127.0.0.1:8787/api/compare \
  -X POST -H "Content-Type: application/json" \
  -d "{\"url\":\"https://item.jd.com/100012043978.html\"}"
```

---

## 三、配置 API Key

复制 `.env.example` 为 `.env`（放在项目根目录），按需填入：

```bash
cp .env.example .env
```

| 变量 | 用途 | 申请入口 |
|---|---|---|
| `JD_APP_KEY` / `JD_APP_SECRET` | 京东联盟 | 京东联盟 → 我的推广 → API 权限 → 创建应用 |
| `TAOBAO_APP_KEY` / `TAOBAO_APP_SECRET` | 阿里妈妈淘宝客 | 阿里妈妈 → 推广管理 → 媒体备案 → 创建应用 |
| `TAOBAO_TBK_ME` | 淘宝客券查询（可选） | 淘宝客优惠券接口授权串 |
| `PDD_CLIENT_ID` / `PDD_CLIENT_SECRET` | 多多进宝 | 多多进宝 → 开放平台创建应用 |
| `PDD_PID` | 多多进宝推广位（可选） | 多多进宝 → 推广位管理 |
| `HISTORY_API_BASE_URL` / `HISTORY_API_KEY` | 历史价格第三方接口 | 慢慢买类服务商 |
| `HISTORY_PRICE_UNIT` | 上游价格单位，`yuan`（默认）或 `cent` | — |

`.env` 加载优先级：系统环境变量 > 根目录 `.env` > `server/.env`（先加载者不被后加载者覆盖）。
密钥只存在于服务端进程内，前端永远拿不到。

验证配置是否生效：

```bash
curl http://127.0.0.1:8787/api/health
# 返回 configured: { jd: true, taobao: false, pdd: false, history: false }
```

---

## 四、架构

```
┌──────────────┐   粘贴链接    ┌────────────────────────────┐
│  React 前端   │ ───────────► │  Express 后端（签名代理层）   │
│ Vite+Tailwind │ ◄─────────── │ /api/parse /api/compare     │
└──────────────┘   比价结果    │ /api/history /api/health    │
                               └────────┬───────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
        ┌──────────┐             ┌──────────┐             ┌──────────┐
        │京东联盟   │             │ 淘宝客    │             │ 多多进宝  │
        │ Adapter  │             │ Adapter  │             │ Adapter  │
        └──────────┘             └──────────┘             └──────────┘
                                        │
                                 ┌──────▼───────┐
                                 │ 历史价 Adapter │  ← 独立数据源
                                 └──────────────┘
```

### 为什么必须有后端

CPS 联盟 API 需要**服务端签名**（MD5 + 密钥包裹），密钥放前端等于泄露，且存在跨域限制。
后端只做**签名代理 + 数据聚合**，不落库、无状态。

### 为什么历史价格要单独接源

京东联盟 / 淘宝客 / 多多进宝等 CPS 联盟 API **均不含历史价格**。
历史价走独立的第三方 Adapter（`server/adapters/history.js`），baseUrl + key 可配置。

### 目录结构

```
price-hunter/
├── index.html                  前端入口
├── vite.config.ts              Vite 配置（含 /api 代理）
├── tailwind.config.js          主题色：brand 橙红主色 / down 红 / up 绿
├── src/
│   ├── main.tsx                React 入口
│   ├── App.tsx                 页面编排与状态机
│   ├── types.ts                前后端共享类型
│   ├── api.ts                  前端 API 封装（统一错误处理）
│   ├── format.ts               价格格式化（分 → 元）与配色
│   └── components/             UI 组件
│       ├── UrlInput.tsx            链接输入 + 粘贴即识别
│       ├── StepsGuide.tsx          三步流程引导
│       ├── DemoDataBanner.tsx      演示数据横幅
│       ├── LowestPriceCard.tsx     全网最低价结论卡
│       ├── PriceCompareTable.tsx   各平台比价表（桌面表格 / 移动卡片）
│       ├── PlatformTabs.tsx        平台切换 Tab
│       ├── CouponList.tsx          可用优惠券列表
│       ├── HistoryPriceChart.tsx   手写 SVG 历史价格折线图
│       ├── LoadingSkeleton.tsx     加载骨架屏
│       └── EmptyState.tsx          空状态 / 错误状态
└── server/
    ├── index.js                Express 入口（含 .env 加载、统一错误处理）
    ├── routes/compare.js       路由：/parse /compare /history /health
    ├── adapters/
    │   ├── registry.js         Adapter 注册表（扩展平台入口）
    │   ├── jd.js               京东联盟（MD5 签名）
    │   ├── taobao.js           淘宝客（Top 协议 MD5 签名）
    │   ├── pdd.js              多多进宝（秒级时间戳 + MD5 签名）
    │   ├── history.js          历史价格（独立第三方源）
    │   └── mock.js             演示数据生成器（确定性种子）
    └── utils/
        ├── sign.js             三家平台签名算法
        ├── http.js             统一 HTTP（8s 超时 + 上游错误识别）
        ├── urlParser.js        链接 / 分享文案解析与商品 ID 提取
        ├── quote.js            ProductQuote 构造与券后价计算
        ├── text.js             标题相似度（跨平台同款匹配）
        └── errors.js           统一错误类型
```

---

## 五、接口文档

统一响应契约：

```jsonc
// 成功
{ "success": true, ...业务字段 }
// 失败
{ "success": false, "error": { "code": "BAD_REQUEST", "message": "可直接展示的中文提示" } }
```

### `POST /api/parse`

粘贴即识别。请求 `{ "url": "https://item.jd.com/100012043978.html" }`

```json
{ "success": true, "url": "https://item.jd.com/100012043978.html",
  "platformId": "jd", "platformName": "京东", "itemId": "100012043978" }
```

### `POST /api/compare`

主流程。请求 `{ "url": "..." }`，响应：

```jsonc
{
  "success": true,
  "input":  { "url": "...", "platformId": "jd", "platformName": "京东", "itemId": "...", "keyword": "..." },
  "product": { /* 原平台 ProductQuote */ },
  "quotes":  [ /* ProductQuote[]，含其它平台同款 */ ],
  "lowest":  { "platformId": "pdd", "platformName": "拼多多", "finalPrice": 308900,
               "saveAmount": 21200, "savePercent": 6.4, "comparedWith": "京东", ... },
  "history": { "points": [{ "date": "2026-03-12", "price": 389900 }], "percentile": 87, "insights": [...] },
  "isMock": true,
  "warnings": [],
  "comparedAt": "2026-09-08T16:00:00.000Z"
}
```

### `POST /api/history`

请求 `{ "url": "..." }` 或 `{ "keyword": "..." }`，响应 `{ success, history, warnings, isMock }`。

### `GET /api/health`

返回服务状态与四个数据源的 Key 配置情况（不暴露密钥）。

---

## 六、关键约定

### 价格单位：分

全链路用**整数分**传输，前端展示时 `/100`，避免浮点误差。
上游返回的「元」必须先用 `toCents()` 转换。

### Adapter 契约

```ts
interface PlatformAdapter {
  platformId: 'jd' | 'taobao' | 'pdd';
  platformName: string;
  parseUrl(url: string): string | null;              // 提取商品 ID，失败返回 null
  queryProduct(itemId: string): Promise<ProductQuote>;
  searchByKeyword(keyword: string, referenceTitle?: string): Promise<ProductQuote | null>;
}

interface ProductQuote {
  platformId: string;
  platformName: string;
  title: string;
  shopName: string;
  imageUrl: string;
  price: number;        // 当前价（分）
  coupons: Coupon[];
  couponTotal: number;  // 最优券金额（分）
  finalPrice: number;   // 券后价（分）
  url: string;
  isMock: boolean;
  note: string;
}
```

### 降级策略

| 场景 | 行为 |
|---|---|
| 未配置 Key | **直接短路**返回 Mock，不发起任何网络请求 |
| 请求超时（8s） | `queryProduct` 降级为 Mock 并附 `warning` |
| 上游返回错误码 | 同上，`warnings` 数组里给出中文原因 |
| 跨平台搜索失败 | 返回 `null`，该平台不参与比价（不用假数据污染） |
| 链接无法识别 | HTTP 400 + 可行动文案（如「短链无法解析，请打开商品页后复制完整链接」） |

`warnings` 会原样透传到前端展示。

---

## 七、扩展新平台

1. 在 `server/adapters/` 新建 `xxx.js`，实现统一契约（`platformId` / `platformName` / `parseUrl` / `queryProduct` / `searchByKeyword`）；
2. 在 `server/utils/urlParser.js` 的 `PLATFORM_RULES` 中登记域名与商品 ID 正则；
3. 在 `server/adapters/registry.js` 的 `ADAPTERS` 数组里注册；
4. 在 `src/format.ts` 的 `PLATFORM_THEME` 加上平台配色；
5. 在 `server/adapters/mock.js` 的 `PLATFORM_PROFILE` 加上演示数据配置。

路由层与前端无需改动。

---

## 八、本期范围

**已实现**：三步交互闭环、三大平台 Adapter、后端签名代理、优惠券聚合与券后价计算、
历史价格曲线、Mock 降级机制、响应式 UI。

**明确不做**：用户账号体系、商品收藏、降价提醒、CPS 返利转链与佣金结算、
浏览器插件 / 小程序、自建爬虫。

## 九、已知限制

- 跨平台「同款匹配」采用**标题关键词模糊匹配**（见规格卡假设 A3），非同一商品的精确匹配；
  精确匹配需要商品库 / 条码库，本期不做。
- 淘宝客优惠券依赖 `TAOBAO_TBK_ME`，未配置时券列表可能为空，不影响价格比价。
- 真实 API 的响应字段映射基于官方文档编写，**首次接入真实 Key 时建议核对一次字段**；
  若某个平台返回体与预期不符，该平台会降级为 Mock 并在 `warnings` 中说明原因。
