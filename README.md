# 台股策略實驗室

單一使用者的虛擬台股帳戶，使用純 HTML/JS、Cloudflare Worker 與 KV。只記錄模擬交易，不連接券商、不送出真實訂單。

## 使用方式

正式網址：https://escape.tippijason.workers.dev/

預設本金新臺幣 100 萬。先記錄策略規則，再填入代號、價格、股數與交易理由進行模擬買賣。可查看持股、已實現／未實現損益、資產曲線及按賣出筆數計算的勝率。已依使用者需求移除歷史回測與日線下載功能。

資料保存在目前瀏覽器；雲端同步需手動上傳／下載。從正式網站開啟時 API 預設使用同網址，也可在 Worker 網址欄明填正式網址。同步密碼只保留目前分頁，重整後需重新輸入。請定期匯出 JSON 備份。

## 本機執行與測試

Node.js 22 以上，執行 `npm start` 後開啟 http://127.0.0.1:8787 。執行 `npm test` 驗證帳戶交易、輸入驗證及報價格式；不需要安裝套件。

直接開啟 `public/index.html` 也可手動記帳。報價是否可用依瀏覽器跨來源限制及 Worker 設定而定。

## 雲端設定與部署

沿用 `wrangler.toml` 的 `escape` Worker 與 KV 綁定。GitHub 的 main 更新後會由 Cloudflare 自動部署。

在 Worker 的 Settings → Runtime variables and secrets → Production 建立 **Secret**，名稱必須為大寫 `TOKEN`。建置環境的變數或小寫 `token` 不適用。於網頁同步密碼欄輸入同一組密碼，再手動同步。勿將密碼寫入程式或 GitHub。

手動部署：`npx wrangler deploy`。新環境需先建立 KV namespace 並更新設定中的 id。若未設定 TOKEN，報價與本機帳戶仍可使用，雲端帳戶 API 會拒絕請求。

## 功能與模型

- 股數須為正整數；現金、持股不足時拒絕交易。
- 買入成本包含手續費；賣出按移動平均成本計算已實現損益。
- 模擬手續費為 0.1425% × 折扣、最低 20 元；股票賣出稅 0.3%、股票型 ETF 0.1%。實際券商／零股費率可能不同；未支援債券 ETF 免稅與當沖減稅。
- 報價區分最近成交、最佳買價、昨收，顯示來源時間；可能延遲或暫時無法取得。
- 匯入、下載與重置前保留復原備份。多裝置請避免同時編輯；KV 未實作原子版本衝突控制。
- 手動交易不模擬撮合、流動性、漲跌停或 T+2 交割。未自動處理配息、分割、減資。回撤只反映已有估值紀錄。

## 檔案與 API

- `public/index.html`：帳戶、持股、交易、同步介面。
- `public/core.js`：共用帳戶驗證。
- `worker/src/index.js`：`GET /quote?codes=2330,6488`、`GET/PUT /account`。帳戶 API 需 Bearer TOKEN；已移除 `/history`。
- `dev-server.mjs`：本機預覽，只綁定 127.0.0.1。測試同步透過環境變數 TOKEN 啟用；本機帳戶檔不納入版控。
- `tests/accounting.test.js`：保留帳戶與報價測試，`tests/fixtures/quote.json` 為公開 MIS 樣本。

本機帳戶 key：`tw-paper-account-v1`；覆蓋前備份：`tw-paper-account-v1-before-restore`；讀入異常原始資料：`tw-paper-account-v1-invalid`。移除回測不改動這些帳戶資料格式。
