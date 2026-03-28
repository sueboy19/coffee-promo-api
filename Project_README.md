# Coffee Promo API — 專案說明

## 目的

獨立的 Cloudflare Workers API 服務，自動抓取台灣 7-11、全家咖啡買一送一優惠資料，提供 REST API 供 free2free 配對平台或其他應用查詢。

---

## 資料來源分析

### 7-11

| 來源 | URL | 格式 | 可行性 |
|------|-----|------|--------|
| **cpok.tw（主力）** | `https://cpok.tw/26184` | HTML 表格（品項/優惠/日期） | **最可行** — 結構清晰 |
| 7-11 官網優惠頁 | `https://www.7-11.com.tw/special/newsList.aspx` | 圖片+連結 | 難抓 |
| CITY CAFE 官網 | `https://www.citycafe.com.tw/notice-cafe5.aspx` | 活動公告 | 次要 |
| OPEN POINT APP | APP 內「行動隨時取」 | 需登入 | 需逆向 |

### 全家 (FamilyMart)

| 來源 | URL | 格式 | 可行性 |
|------|-----|------|--------|
| **cpok.tw（主力）** | `https://cpok.tw/26869` | 同 7-11 格式 | **最可行** |
| 全家官網活動頁 | `https://www.family.com.tw/Marketing/zh/Event` | Banner 圖片 | 需 OCR |
| 全家 Facebook | `facebook.com/FamilyMart` | 圖文貼文 | 需 API |

### cpok.tw 資料範例（歷史資料，僅供格式參考）

> 以下為 2026 年 1 月的活動範例，實際內容以爬蟲抓取為準。

```
| 優惠項目                    | 優惠價       | 活動時間         |
|----------------------------|-------------|-----------------|
| 特大冰濃萃美式咖啡          | 買一送一     | 2026/1/5~2/6    |
| 大杯冰精品馥列白拿鐵咖啡    | 買一送一     | 2026/1/5~2/6    |
| 大杯精品美式               | 買2送2       | 2026/1/7~1/20   |
| CITY PEARL                 | 2杯79折      | 2026/1/7~1/20   |
```

### 全家週期性活動規律

| 活動 | 頻率 | 內容 |
|------|------|------|
| 週一咖啡日 | 每週一 | 第 2 杯 10 元 |
| 每月 6 號好咖日 | 每月 6 日 | 買 6 送 6 |
| 每月 1 號全盈+PAY | 每月 1 日 | 買 3 送 3 |

---

## 技術架構

```
Cloudflare Workers + Hono + D1 + HTMLRewriter（Workers 內建）
```

- **Hono**：輕量 Web 框架（與 free2free 一致）
- **D1**：SQLite 資料庫
- **HTMLRewriter**：Workers runtime 內建的 Rust 串流 HTML 解析器（零依賴、零 cold-start）
- **Cron Triggers**：每日自動爬蟲（UTC 6:00 = 台灣 14:00）

---

## 專案結構

```
coffee-promo-api/
├── src/
│   ├── index.ts              # Hono app + scheduled handler
│   ├── routes/
│   │   ├── promotions.ts     # 公開查詢 API
│   │   └── admin.ts          # 管理端點（API Key 驗證）
│   ├── services/
│   │   └── scraper.ts        # 爬蟲主邏輯：fetch → parse → dedup → upsert
│   ├── lib/
│   │   ├── db.ts             # D1 資料庫操作
│   │   ├── parser.ts         # HTMLRewriter 表格解析
│   │   └── normalize.ts      # 日期解析 + 優惠類型正規化
│   └── types/
│       └── index.ts          # TypeScript 介面
├── migrations/
│   └── 0001_initial.sql
├── .dev.vars.example         # 機密變數範本
├── .dev.vars                 # 機密變數（gitignore，不進版控）
├── .gitignore
├── wrangler.toml
├── package.json
└── tsconfig.json
```

---

## API 端點

### 公開端點

| Method | Path | 說明 |
|--------|------|------|
| `GET` | `/` | Health check |
| `GET` | `/promotions` | 列出優惠（支援 brand, status, deal_category, limit, offset） |
| `GET` | `/promotions/active` | 目前進行中的優惠 |
| `GET` | `/promotions/:id` | 單筆優惠詳情 |
| `GET` | `/health` | 系統狀態（DB連線、上次爬蟲時間） |

### 管理端點（X-API-Key 驗證）

| Method | Path | 說明 |
|--------|------|------|
| `POST` | `/admin/scrape` | 手動觸發爬蟲 |
| `DELETE` | `/admin/promotions/expired` | 清除過期資料 |

### Cron 排程

每日 UTC 6:00（台灣 14:00）自動執行 `scraper.scrapeAll()`

---

## 爬蟲流程

```
1. fetch(cpok.tw URL) → 取得 HTML
2. HTMLRewriter 解析 <table> → 找到含「優惠項目/優惠價/活動時間」的表格
3. 逐行收集 <td> 文字 → 跳過 <s>/<del>（刪除線=已過期）
4. 正規化：
   - 日期：'2026/1/5~2/6' → start: 2026-01-05, end: 2026-02-06
   - 優惠類型：'買一送一' → category: bogo
5. 去重：store_brand + product_name + start_date + end_date
6. Upsert：已存在 → UPDATE；不存在 → INSERT
7. 標記過期：此次沒出現且 end_date 已過 → status: expired
```

---

## 與 free2free 整合方式

```
coffee-promo-api (獨立服務)
       │
       │  GET /promotions/active
       ▼
free2free_wrangle (配對平台)
       │
       │  將優惠建立為 Activity（加 store_brand, start_date, end_date）
       ▼
用戶看到咖啡 Activity → 開配對
```

free2free 需要的改動（之後實作）：
1. `migrations/0005_*.sql`：activities 加 store_brand, start_date, end_date, image_url
2. `src/routes/admin.ts`：加 `POST /admin/coffee-sync` 同步端點
3. 前端：品牌 badge + 咖啡促銷區塊

---

## 環境變數

### wrangler.toml（非機密設定）

已內建在 `[vars]` 中：`ENVIRONMENT`、`CORS_ORIGINS`、`CPOK_711_URL`、`CPOK_FAMILYMART_URL`

### .dev.vars（機密設定，不進版控）

```bash
# 複製範本並填入
cp .dev.vars.example .dev.vars
```

| 變數 | 說明 | 範例 |
|------|------|------|
| `API_KEY` | 管理 API 存取金鑰 | `my_secret_key_123` |

---

## 待辦事項

- [ ] `npm install` 安裝依賴
- [ ] `npx wrangler d1 create coffee-promo-db` 建立資料庫
- [ ] 填入 database_id 到 wrangler.toml
- [ ] `cp .dev.vars.example .dev.vars` 並設定 API_KEY
- [ ] `npm run db:migrate:local` 執行 migration
- [ ] `npm run typecheck` 確認型別無誤
- [ ] `npm run dev` 啟動本地測試
- [ ] 手動觸發爬蟲驗證資料（`POST /admin/scrape` + `X-API-Key` header）
- [ ] 確認全家 cpok.tw URL（`/26869` 待驗證）
- [ ] 加入單元測試（已有 vitest 依賴）
- [ ] 部署到 Cloudflare Workers
