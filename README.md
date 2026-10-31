# 台股虛擬投資帳戶

用來實驗台股投資策略的模擬交易網頁:虛擬資金下單、即時報價、績效統計、歷史回測、雲端同步。
前端是單一 HTML 檔,後端是一個 Cloudflare Worker,兩者用同一個 Worker 部署。

## 檔案結構

```
public/index.html     前端(純 HTML/CSS/JS,無建置步驟、無外部套件)
worker/src/index.js   Cloudflare Worker:報價轉送、歷史資料、帳戶同步
wrangler.toml         Worker 設定(名稱、靜態檔目錄、KV 綁定)
```

## 功能

- **虛擬帳戶**:自訂初始資金;買進/賣出(以股為單位,1 張 = 1000 股,可零股);現金或持股不足會擋下。
- **台股費用**:手續費 0.1425% × 折扣(低消 20 元);證交稅於賣出時收取,一般股票 0.3%、ETF 0.1%。
- **持股與紀錄**:均價(含手續費)、現價、市值、未實現/已實現損益、報酬率、完整交易紀錄。
- **績效**:資產曲線、交易筆數、勝率、平均獲利/虧損、最大回撤。
- **即時報價**:「查即時價」帶入下單價格;「更新股價」更新持股現價;可勾選盤中(週一至五 9:00–13:35)每 30 秒自動更新。
- **策略回測**:均線交叉、定期定額、買進持有,可加停損/停利 %,並與「期初單筆買進持有」比較。每日以收盤價成交,含手續費與證交稅。
- **雲端同步**:每次變動自動上傳到 Worker 的 KV;開啟頁面時雲端版本較新就自動載入。需要同步密碼。
- **備份**:匯出/匯入 JSON。

資料預設存在瀏覽器 localStorage(key `tw-paper-account-v1`);Worker 網址與同步密碼存在 `tw-paper-cloud`。

## Worker API

| 路徑 | 說明 |
|---|---|
| `GET /quote?codes=2330,0050` | 即時報價,轉送證交所 MIS(`mis.twse.com.tw`),上市/上櫃皆查。沒有成交時退回最佳買價,再退回昨收。 |
| `GET /history?code=2330&months=12` | 日線資料(最多 60 個月)。上市走證交所 `STOCK_DAY`,上櫃走櫃買中心 `tradingStock`。每月結果快取在 KV:過去月份永久,當月 1 小時。 |
| `GET /account`、`PUT /account` | 讀寫帳戶資料,需 `Authorization: Bearer <TOKEN>`。 |

頁面由 Worker 網址開啟時,會自動使用同網址的 API;用其他方式開啟(例如本機檔案)則要在頁面「雲端同步與報價伺服器」填 Worker 網址。

## 部署

需要 Cloudflare 帳號與 Node.js。

1. 建立 KV namespace,並把 `wrangler.toml` 裡的 `id` 換成你的:
   ```bash
   npx wrangler kv namespace create tw-paper
   ```
2. 部署:
   ```bash
   npx wrangler deploy
   ```
3. 設定同步密碼(不設的話報價和回測照常可用,只有雲端同步會失敗):
   ```bash
   npx wrangler secret put TOKEN
   ```
4. 打開 wrangler 印出的網址(`https://escape.<子網域>.workers.dev`),在頁面填入同步密碼,按「儲存並測試」,應該會顯示 2330 的即時價格。

也可以在 Cloudflare 後台用 Workers → Import a repository 接 GitHub,root 目錄留空,之後每次 push 自動部署;Secret 改在 Worker 的 Settings → Variables and Secrets 設定。

本機開發:`npx wrangler dev`。

## 目前狀態與待辦

- 前端流程(下單、費用計算、績效、雲端同步、三種回測)已用 Playwright 搭配模擬的 Worker 回應測過。
- **尚未用真實資料驗證**:證交所 MIS、`STOCK_DAY` 與櫃買中心 `tradingStock` 的回應格式是依公開介面的已知格式撰寫,開發環境連不到這些網站。部署後最需要先確認報價和回測抓得到資料,欄位若有變動,改 `worker/src/index.js` 的 `quote()`、`twse()`、`tpex()`、`parseRows()`。
- 這些是非官方的公開介面,可能延遲、限流或改版。
- 雲端同步是單一帳戶、單一密碼的設計;要多人使用需要加上帳號機制。
- 想法:規則策略直接套用到虛擬帳戶自動下單、多帳戶比較策略、回測加入除權息。
