# pyflow：給 Claude Code 的專案說明

**唯一要回答的問題：使用者關心的某個變數如果改變，哪些地方會跟著改變？**
產品主軸是 `graph.impact()`：游標放在變數上，標出它的值可能到達的每個地方（變數、回傳值、輸出、受條件影響的地方），
並說明路徑。介面共用同一個分析器：網頁（`web/`，預設是「會影響哪裡」模式）、命令列、以及 VS Code 擴充功能
（見「結構」）。分析在瀏覽器內以 Pyodide 執行，檔案不上傳。設計決策與理由見
`docs/superpowers/specs/2026-10-28-pyflow-design.md`，功能與限制見 `README.zh-TW.md`，不在此重複。
最近一輪的進度、尚未驗證的部分與待決事項見 `docs/handoff.md`，接續工作前先讀。

## 專案目標

作為公開的 GitHub 社群貢獻作品，不以營利為目的；目標是做到值得被推薦與上架 VS Code Marketplace 的品質。
取捨時優先考慮：結果可信（漏掉比多標更傷信任）、容易上手、容易回報錯誤與貢獻。
作者是學習中的 Python 開發者，邏輯不外包：改動前先說明做法與原因，避免一次改很多。

## 與使用者互動的偏好

- 使用繁體中文，回覆簡潔，不使用 emoji。
- 程式碼必須附註解，風格與周圍程式碼一致。
- 完成後做自我評估：做到什麼、沒驗證到什麼、有什麼不足。
- 請求不完整時先問，不要猜。

## 使用者已做的決定（不要重新討論）

- 圖由左至右（桌面）；寬度小於 600px 才改為由上而下。
- 搜尋用模糊比對加候選清單，同名變數依作用域分開顯示。
- 函式讀取全域或外層變數時畫線；只有 `global`／`nonlocal` 重新綁定才列為未分析。
- `cart = Cart(); cart.add()` 解析到 `Cart.add`，以及 dataclass 欄位當建構子參數：保留。
- 無法靜態追蹤的寫法一律列在「未分析」，不得默默略過；影響結果若涉及這些地方，必須附警告。
- 條件（if／迴圈／守衛式提前返回）也算影響，但以 `control` 邊與 `influence: "condition"` 另外標示，可關閉。
- 物件取決於其建構子引數；`self.x` 是以類別為單位的屬性節點。
- 名稱 pyflow、MIT 授權，著作權人維持 `archi9882`。README 英文為主，另附繁體中文。
- pyflow 已於 2026-11-10 搬到獨立 repo `archi9882/PYFLOW`（歷史以 `git subtree split` 帶過來）。
  舊位置 `archi9882/SciML` 的 `pyflow/` 之後不再更新；舊提交與 PR #1、#2 留在那邊。

## 指令（在專案根目錄執行）

```bash
python -m pytest                    # 110 個測試，改動後不應減少（test_flow.py 需要 Node，沒有就略過）
python scripts/serve.py             # 建置、下載函式庫（只第一次）、啟動並開啟瀏覽器
python scripts/serve.py --no-open   # 同上，不開瀏覽器
python scripts/build_site.py        # 只建置到 _site/
```

只用 Python 標準函式庫，核心不需要安裝任何套件（測試需要 pytest）。支援 Python 3.10 以上。

編輯器內標記的擴充功能（`vscode-impact/`）：

```bash
cd vscode-impact && npm ci && npm run prepare-assets   # 複製分析器、下載圖形函式庫
npm test                                               # 型別檢查 + 22 個測試（含真實 Python 與模擬編輯器）
npx vsce package --no-dependencies --allow-missing-repository   # 產生 .vsix
```

## 結構

- `core/pyflow/analyzer.py`：`ast` 兩階段分析（先建作用域，再走訪敘述產生邊）
- `core/pyflow/graph.py`：搜尋、上下游鄰域、整檔呼叫圖、函式內部視圖（`function_inside`：參數與區域變數畫成框，只往外一步），
  以及 `impact()`（最小成本路徑，先比經過幾個條件、再比步數；分類 value／returns／runs／effect／external／caller；
  每項有 `path`、`where`、精確詞位置 `affected_refs`、`warnings`）與 `locate(line, col)`
- `core/pyflow/analyzer.py` 的 `refs`：每個名稱出現的位置，欄位為 UTF-16（編輯器與 JavaScript 的單位），
  不是 `ast` 的 UTF-8 位元組；中文與 emoji 在同一行時一定要驗證
- `core/pyflow/api.py`：網頁透過 Pyodide 呼叫的 JSON 介面
- `web/`：index.html、app.js、style.css；`scripts/vendor.py` 下載並驗證函式庫雜湊
- `vscode-impact/`：VS Code 擴充功能「改了會影響哪裡」（TypeScript）：在編輯器內標出答案、Explorer 清單、hover、狀態列，
  以及「完整視圖」（`src/fullView.ts`）：在編輯器旁載入與網頁相同的頁面，並隨游標改問該名稱。所有開圖的入口
  （指令面板、狀態列、影響清單按鈕、「如果改變它…」）都通往完整視圖。`site/` 由 `npm run prepare-assets` 產生，
  不進版控，擴充功能約 15 MB。`src/core.ts` 是不依賴 `vscode` 的純邏輯（可用 Node 測試）；`extension.ts` 只負責接線；
  `runner.ts` 以 `python -I -c` 啟動隨附的分析器，原始碼走 stdin，所以未儲存的修改也能分析。
  舊的 `pyflow/vscode/` 擴充功能與輕量圖形頁已移除。
- `web/flow.js`：詳細資料面板的分類（引數、回傳、結果去向），不碰 DOM，由 `tests/test_flow.py` 透過 Node 測試
- `tests/`：每種語法一個小片段；`examples/`：四種風格的示範檔

## 改動時的驗證

- 改擴充功能 `vscode-impact/`：先改 `core.ts` 並補測試；`extension.ts` 的測試用的是模擬的 VS Code API
  （`test/fakeVscode.ts`），**無法證明在真實 VS Code 中的行為**，改動後請實際在 VS Code 操作一次
  （裝飾顏色、樹狀檢視、hover、webview）。啟動方式沿用 `.vscode/tasks.json` 的做法，不用 F5。

- 改分析器：在 `tests/test_analyzer.py` 補一個小片段說明預期的邊，再跑 `python -m pytest`。
  若使用者回報「圖畫錯了」，請對方給最小程式碼片段和預期的邊，直接轉成測試。
- 改網頁：單元測試測不到。請實際啟動 `scripts/serve.py`，在瀏覽器操作，並用一個大檔案
  （例如標準函式庫的 `argparse.py`，約 2,700 行）確認總覽與搜尋仍可讀。排版改動一定要看實際畫面。
- 手機寬度、深色模式、中英切換都要看一次。

## 設計上不要弄壞的幾點（都曾實際出過問題）

- 外部呼叫（`print`、`len`）只進不出。若讓它們當資料的中繼點，不相關的變數會被連在一起。
- 鄰域查詢不跨「呼叫」與「資料流」兩種邊。否則查一個變數會牽出所有呼叫者。
- 類別框只在沒有非成員節點落在框內時才畫，否則框會宣稱錯誤的歸屬。
- 縮放有下限（0.6），避免大檔案縮到文字看不見。
- 網站不得依賴 CDN；所有函式庫走 `vendor/`，並比對 npm 公布的雜湊。

## 版本控制

- `.venv/`、`_site/`、`.vendor-cache/` 不進版控。
- 每項工作從最新的 `main` 開新分支，不要直接推到 `main`。（PR #1、#2 在舊 repo `archi9882/SciML`，已併入其 `main`，分支不再使用。）
- 保持 git 圖是一條直線：分支壽命要短，一項工作做完就開 PR；工作期間不要把 `main` 合併進分支
  （會多出菱形）。合併 PR 一律用 Squash and merge，每個 PR 在 `main` 上只留一個提交。
  若 `main` 前進造成衝突，在 PR 頁面或用 rebase 解決，不要另外產生「合併 main」的提交。
- 看歷史用 `git log --graph --oneline --decorate --first-parent main`，只顯示主線。
- 推送前先確認使用者同意。
- 要開 PR 時，主動寫好標題與說明，不必等使用者要求。用繁體中文，內容包含摘要、改動、測試、
  尚未驗證的部分、已知限制與相關 PR，以可直接貼上 GitHub 的格式提供。這台電腦沒有 `gh`，
  使用者在網頁上開 PR。

## 尚未驗證（雲端環境做不到）

- `vscode-impact/` 的完整視圖、各入口與游標追蹤已由使用者在真實 VS Code 驗證（2026-11-09）；
  Python 擴充套件的直譯器偵測仍沒實測。
- 發布到 Marketplace：需要使用者自己的 publisher 帳號；`package.json` 的 `publisher` 要確認為其 ID。
- README 的動畫是網頁示範的畫面，不是 VS Code 的畫面；擴充功能的真實截圖要在本機補。

## 已知限制與後續

見設計文件第 5、6 節。主要是：單檔、每個屬性一個節點（不區分物件）、不追蹤別名、
控制流程不畫成資料流。可能的下一步：跨檔案分析、呼叫情境敏感、匯出圖片。
