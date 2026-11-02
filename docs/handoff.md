# pyflow 交接：VS Code 擴充功能與介面微調

最後更新：2026-11-03　分支：已併入 main（PR #2），原分支 `pyflow-vscode-extension` 已刪除

給下一個 session：先讀 `pyflow/CLAUDE.md`，再讀這份。這份只記錄這一輪的進度、
尚未驗證的部分與待決事項；設計理由見 `docs/superpowers/specs/2026-10-28-pyflow-design.md`。

## 這一輪做了什麼

### VS Code 擴充功能（`pyflow/vscode/`）

| 階段 | 內容 | 狀態 |
| --- | --- | --- |
| 1 | 指令 `pyflow: Open flow view` 在編輯器右側開 Webview | 使用者已確認 |
| 2 | Webview 載入與網站相同的頁面（`media/`），注入 `<base>` 與 CSP | 使用者已確認 Pyodide 可執行、圖可顯示 |
| 3 | 自動讀取目前的 .py 檔；切換編輯器、存檔時更新；存檔後保留原中心節點 | 使用者測過「重新整理」可讀到新內容 |
| 3+ | 右上角「重新整理」按鈕（只在 VS Code 內顯示），可讀未存檔內容 | 同上 |

- `media/` 是建置產物，不進版控。改了 `web/` 一定要重建：`python scripts/build_site.py vscode/media`（在 `pyflow/` 下）。
- 網頁與擴充功能以訊息溝通：頁面送 `ready`、`refresh`；擴充功能送 `{type: "file", name, path, text}`。
- `web/app.js` 只在 `acquireVsCodeApi` 存在時才監聽訊息，網站版行為不變。
- `app.js` 第 7 行改用 `document.baseURI`（原為 `location.href`），讓 Webview 的 `<base>` 生效。

### 網頁介面（網站與擴充功能共用）

- 詳細資訊面板依邊的種類分類：被呼叫、傳入引數、回傳、結果去向、呼叫、區域變數；變數則是來自、流向。
  邏輯在 `web/flow.js`（不碰 DOM），由 `tests/test_flow.py` 透過 Node 測試。
- `result` 邊有三種意義，依目標分辨：指向參數是引數（`f(g())`）、指向外部呼叫是傳給它（`print(g())`）、
  指向檔案內的函式是回傳（`return g()`）。`tests/test_flow.py` 有對應測試。
- 函式內部視圖：以函式或方法為中心時，參數與區域變數畫在函式框內，只往外一步。
  邏輯在 `core/pyflow/graph.py` 的 `function_inside`，`api.inside` 提供給網頁。左側「函式內部」勾選框，預設開啟。
- 左右面板可收合（圖左右邊緣中央的把手），也可拖曳分隔線調整寬度（雙擊恢復預設、方向鍵微調）。
- 詳細資訊每一欄可摺疊，標題旁有「全部摺疊／全部展開」。
- 收合、寬度、摺疊狀態存在 `localStorage`，失敗時退回預設。

### 其他

- `pyflow/local/`：個人測試檔，不進版控。目前有 `data_pipeline_test.py`（範例加上 `y = 100`）。
- `examples/data_pipeline.py` 曾被測試改動，已用 git 還原。
- 測試：46 → 61 個，`python -m pytest` 全過。

## 尚未驗證（下一步優先）

使用者還沒回報以下項目的實際畫面，程式只經過語法檢查與單元測試：

1. 函式內部視圖的排版：框是否正確、`run_pipeline` 這種連線多的函式是否可讀。
2. 面板收合把手、拖曳分隔線、詳細資訊摺疊。
3. CLAUDE.md 要求的檢查：大檔案（`argparse.py`）、手機寬度、深色模式、中英切換。
4. 網站版（`python scripts/serve.py`）這一輪完全沒有在瀏覽器開過。

## 已知問題與限制

- **F5 除錯會閃退**：在這台電腦以除錯器啟動擴充功能主機會以 code 134 中止，根本原因未找到
  （紀錄無錯誤、無傾印檔）。不經除錯器正常，所以改用 `.vscode/tasks.json` 的 task `pyflow extension`
  啟動（Ctrl+Shift+P → Tasks: Run Task）。已開著開發主機視窗時，再執行 task 會重用該視窗，改按 Ctrl+R 重新載入。
- **`python` 指令**：這台電腦的 `python` 先找到 Windows 商店的替身程式（無輸出、回傳 49）。
  實際的 Python 3.11 在 `C:\Users\88696\AppData\Local\Programs\Python\Python311\python.exe`，
  可在「應用程式執行別名」關掉 python.exe 的別名。
- `rows = clean(rows)`：同一個變數既傳入又接收結果，函式內部視圖只能畫一次，放在左側，結果箭頭往回指。
- 函式內部視圖下，深度與方向設定沒有作用，但滑桿仍可調（可能讓人困惑）。
- 視窗縮小時不重新套用寬度限制，圖區可能小於 320px。
- 測試只涵蓋 Python 核心與 `flow.js`；DOM 互動、擴充功能沒有自動化測試。
- `test_flow.py` 在沒有 Node 的環境會略過。

## 待決事項與候選下一步

- 點圖上的節點，讓編輯器跳到對應行（反向跳轉）。
- 打包成 `.vsix` 安裝到一般 VS Code（`npx @vscode/vsce package`），不再需要開發主機。
- 邊打字邊更新（目前只在切換、存檔、按重新整理時更新）。
- 函式內部視圖下停用深度滑桿。
- （已完成）分支已透過 PR #2 併入 main。

## 使用者這一輪做的決定（不要重新討論）

- 擴充功能分階段做，放在同一個 repo 的 `pyflow/vscode/`。
- 啟動方式用 task，不用 F5。
- 詳細資訊面板的分類保留；圖上另外加函式內部視圖，用勾選框切換、預設開啟。
- 收合把手放在圖的左右邊緣；詳細資訊摺疊後每欄留標題與數量。
- 個人測試檔放 `pyflow/local/`，不放 `examples/`。
