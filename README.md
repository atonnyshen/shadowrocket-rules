# Shadowrocket & Clash Optimized Profiles

極簡扁平化跨平台分流配置（Shadowrocket iOS / iPadOS），內建 YouTube/Threads 高頻寬優選、日常全節點低延遲選路與 Gemini 純美出口防風控。

---

## 🚀 訂閱與配置下載端點

### 1. 牆內直連通道（免翻牆，支援北京與國內直連）

基於 GitHub + 全球 Anycast CDN（jsDelivr）鏡像，國內直連不被 GFW 阻斷：

* **Shadowrocket 配置（主用 CDN）**：
  ```
  https://cdn.jsdelivr.net/gh/atonnyshen/shadowrocket-rules@main/Shadowrocket_Atonny_Optimized.conf
  ```
* **備用 CDN 鏡像（若主用 CDN 偶發波動可切換）**：
  * Fastly CDN：
    ```
    https://fastly.jsdelivr.net/gh/atonnyshen/shadowrocket-rules@main/Shadowrocket_Atonny_Optimized.conf
    ```
  * GCore CDN：
    ```
    https://gcore.jsdelivr.net/gh/atonnyshen/shadowrocket-rules@main/Shadowrocket_Atonny_Optimized.conf
    ```

---

### 2. 官方海外通道（Cloudflare Worker 邊緣端點）

若已開啟代理或身處海外，可直接使用 Cloudflare Worker 端點：

* **配置網址**：`https://tshl-sub.atonny.workers.dev/conf`
* **節點訂閱**：`https://tshl-sub.atonny.workers.dev/sr`

---

## ⚙️ 核心策略組設計

1. **🚀 影音高速**：`url-test` 大頻寬日美星港優先，排除台灣低頻寬小水管，徹底告別 YouTube / Threads 轉圈。
2. **🌐 日常瀏覽**：`url-test` 100% 完整保留全區節點（台灣專線、日、星、美、港），自動優選最低延遲。
3. **🔷 Gemini 專區**：`fallback` 首選美國 02，次選其他美國專線，備援日台專線（嚴格排除港澳與異常美國 03/04/05），測試端點指定 `https://www.google.com/generate_204`。
4. **🛑 廣告攔截**：`select` REJECT 攔截常見廣告與追蹤。

---

## 🔄 自動化維護說明

本倉庫由本地工作區 `deploy_worker.py` 在發布時自動進行多端聯動同步（Cloudflare + 本地 iCloud + GitHub jsDelivr）。
每次更新後會自動調用 jsDelivr Purge API 清除快取，確保全球節點即時下發最新內容。
