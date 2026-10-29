# pyflow

[English](README.md)

把 Python 檔拖曳到網頁上，輸入變數或函式名稱，就能看到它的值從哪裡來、往哪裡去。

**線上試用：** https://archi9882.github.io/SciML/

- 完全在瀏覽器內執行，檔案不會上傳。
- 不需安裝：分析器是純 Python，透過 [Pyodide](https://pyodide.org) 在瀏覽器中執行。
- 適用任何 `.py` 檔：腳本、函式模組、類別、資料處理管線。

## 在本機執行

```bash
cd pyflow
python scripts/serve.py
```

這個指令會建置網站，第一次執行時下載所需函式庫（約 14 MB，會比對 npm 公布的雜湊值，
並快取在 `.vendor-cache/`），在 http://127.0.0.1:8000 啟動並開啟瀏覽器。
之後不需網路也能使用。需要 Python 3.10 以上，不需安裝其他套件。

## 使用方式

1. 開啟網頁，把 `.py` 檔拖曳進去（或選擇範例）。
2. 一開始會顯示整個檔案的呼叫圖：哪個函式呼叫哪個函式。
3. 在搜尋欄輸入名稱，候選清單會即時出現，並標示作用域；
   因此 `load()` 裡的 `data` 與 `main()` 裡的 `data` 是兩個不同的項目。
4. 選擇其中一個。圖由左至右流動：
   - **橘色、左側**：上游，值從哪裡來
   - **藍色、中間**：你選的名稱
   - **綠色、右側**：下游，值往哪裡去
5. 點擊任一節點即可改以它為中心。側欄可調整**深度**、**方向**，以及**呼叫／資料流／外部呼叫**篩選。

頁面上還可以：

- **滑過**節點，高亮它與中心之間的完整路徑。
- **點擊原始碼某一行**，跳到該行定義或使用的名稱。
- 原始碼面板會標示目前圖中涉及的行。
- 版面允許時，類別的方法與屬性會畫在類別框內；大型檔案的總覽會把方法收合進所屬類別。
- 按 <kbd>/</kbd> 跳到搜尋欄。支援英文與繁體中文、淺色與深色模式。

## 圖上的連線

| 連線 | 意義 | 例子 |
|---|---|---|
| 呼叫 | 函式 A 呼叫函式 B | `def main(): load()` |
| （賦值） | 值流入變數 | `total = price * qty` |
| 引數 | 值被傳入參數或外部呼叫 | `clean(rows)` |
| 回傳 | 變數被回傳 | `return result` |
| 結果 | 函式的回傳值被使用 | `rows = load(path)` |

本版支援：

- 一般賦值、擴增賦值（`+=`）、型別註記賦值
- 函式參數、預設值、回傳值、呼叫引數（位置與關鍵字）
- 解構賦值（`a, b = x, y` 會逐一配對）、`for` 迴圈變數
- 生成式（comprehension）、lambda、`with ... as`、`except ... as`、海象運算子
- 透過 `self`、類別本身，或同一作用域中建立的實例（`cart = Cart(); cart.add(...)`）
  與有型別註記的參數（`p: Product`）呼叫的方法
- 同一檔案中基底類別的繼承方法，以及 `super().method()`
- 屬性：某個方法中 `self.x = ...` 的值，會流到另一個方法讀取的 `self.x`；
  dataclass 欄位也是同一個屬性（`Product(name, price)` 會填入 `Product.price`）
- 就地填入的容器：`items.append(x)`、`d.update(...)`、`d[k] = x`
- 讀取模組層級與外層函式的變數
- 呼叫函式庫與內建函式（以虛線的「外部」節點表示）

## 限制（判讀圖之前請先看）

pyflow 只讀程式碼、不執行。執行時才決定的行為可能被漏掉。pyflow 不會默默略過這些地方，
而是列在**未分析**面板，並以紅色虛線框標示受影響的節點：

| 標示為 | 為何無法靜態追蹤 |
|---|---|
| `*args`／`**kwargs` | 哪個引數落到哪裡要執行時才知道 |
| 裝飾器 | 裝飾器可以替換函式或改變其簽名 |
| 動態呼叫（`getattr`、`exec`、`eval` 等） | 呼叫目標在執行時才算出來 |
| `global`／`nonlocal` 重新綁定 | 寫入有連線，但可能還有其他寫入者 |
| `match`／`case` | 尚未追蹤模式比對擷取的變數 |
| `from x import *` | 無法得知匯入了哪些名稱 |

其他需要留意的簡化：

- **一次一個檔案。** 從你其他檔案匯入的東西視為外部呼叫。
- **不區分呼叫情境。** 若 `f` 在兩處被呼叫，從其中一處傳入的值，看起來會流到兩處的結果。
- **每個屬性一個節點，不區分物件。** 兩個 `Cart` 物件共用 `Cart.items` 這個節點。
- **不追蹤別名。** `b = a; b.append(x)` 不會標示 `a` 被改變。
- **控制流程不等於資料流。** `if x > 0: y = 1` 不會畫出 `x -> y`。
- 不追蹤其他檔案（或函式庫）中的基底類別。

## 命令列

分析器也可以不透過瀏覽器使用：

```bash
cd pyflow
pip install -e .
pyflow examples/pure_functions.py              # 摘要與未支援清單
pyflow examples/pure_functions.py -q tokens    # 某個名稱的上下游
pyflow examples/pure_functions.py --json       # 完整的圖（JSON）
```

或在 Python 中使用：

```python
from pyflow import analyze, search, subgraph

graph = analyze(open("my_script.py").read())
hit = search(graph, "total")[0]
view = subgraph(graph, hit["id"], depth=2, direction="both")
```

## 開發

```bash
cd pyflow
pip install pytest
python -m pytest                       # 分析器、搜尋與命令列測試
python scripts/build_site.py           # 組裝可離線使用的網站到 _site/
python scripts/serve.py --no-open      # 在 http://127.0.0.1:8000 啟動
```

專案結構：

```
pyflow/
  core/pyflow/     分析器（ast -> 圖）、搜尋與鄰域查詢、命令列、Pyodide 介面
  tests/           pytest：每種語法一個小片段
  web/             index.html、app.js、style.css（Cytoscape.js + dagre 版面）
  examples/        四種風格的示範檔：腳本、純函式、類別、資料管線
  scripts/         vendor.py（固定版本並驗證雜湊的函式庫）、build_site.py、serve.py
  docs/            設計文件
```

GitHub Actions 工作流程 `.github/workflows/pyflow.yml` 會在 Python 3.10、3.12、3.13
上執行測試，並從 `main` 發布網站到 GitHub Pages。

## 授權

[MIT](LICENSE)
