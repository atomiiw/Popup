# 下一步计划：DeepSeek / claude.ai 支持 + popup 里附图提问

最后更新：2026-10-28。接手的人先读这份，再读 `collab/HANDOFF.md`。实测证据在 `collab/evidence/claude/` 和 `collab/evidence/deepseek/`（只在本地，不进 git）。

## 当前状态（这一轮停在哪里）

- `main` 上的 1.2.9 是正式版本，只支持 ChatGPT；商店 zip 是 `dist/Popup-1.2.9.zip`。
- 工作区里有**没提交的探针改动**：
  - `src/probe-net.js`：只在 claude.ai / chat.deepseek.com 上运行（页面环境），记录请求的形状，写进 `#jr-probelog`，不记正文。
  - `src/dev-imgtest.js`：只在 ChatGPT 上运行（页面环境），网址加 `#jr-imgtest=A|B|C` 时往输入框里放一张测试图，不发送，过程写进 `#jr-imglog`。
  - `manifest.json`：加了 claude.ai 和 DeepSeek 的权限和探针脚本，ChatGPT 的页面环境脚本里多了 `dev-imgtest.js`，`version_name` 是 `1.2.9-probe.4`。
  - **这些只用于评估，不能打进商店 zip。** 正式实现时删掉探针，或者用正式代码替换它。
- DeepSeek 测试对话已经建好，路径形如 `/a/chat/s/fb177f05…`。用户批准的 5 条消息还剩 4 条。

## 顺序（2026-10-28 晚，用户定）

1. **先做：特殊回答格式审查（下一节）**，把 popup 在各种回答格式下的问题查清、修好。
2. 然后才做 popup 里附图提问、DeepSeek 适配。
3. 以后写代码：用 ponytail（`/ponytail-review`、`/ponytail-audit`）检查简洁度和实现漏洞；用 grilling 跟用户确认设计细节和技术方案，确认之后再动手。

## 特殊回答格式审查（ChatGPT）——最先做

### 用户报告的问题（2026-10-28，截图在用户那里）

| # | 格式 | 现象 | 初步猜测（待实测确认） |
|---|---|---|---|
| R1 | 列表（bullet / 编号） | 选区跨两个列表项时，引用里**同一个 bullet 出现两遍**：先是整条，再是从句子开头截的一段 | `extractSentenceInContainer` 跨块时，第一个块既作为整块收进来，又作为句子起点再收一次 |
| R2 | 新的「步骤卡片」（带圆圈序号、竖线、右上角标签如「生活事务」的分段卡片） | 同 R1，引用里第 3 项重复；序号和标题、正文分在不同元素里 | ChatGPT 新加的 HTML 组件，不是普通 `<ol>`，块边界判断不对 |
| R3 | 代码块（新样式：标题栏「Python」+ Run 按钮） | **页面上代码没有被高亮**，但引用里的高亮正常；引用里混进了「PythonRun」，并且**换行全丢了**（所有行连成一段） | 代码块的 DOM 又改了：`[data-code-block-source]` 可能找不到了，退回整块 `textContent`（带工具栏文字）；如果代码是按行的 `div`（类似 CodeMirror 的 `.cm-line`），`textContent` 不带换行；编辑器重绘会删掉我们插进去的高亮 span |
| R4 | 图表（SVG 折线图，坐标轴数字） | 选中横轴数字 2–6 后，**图表被弄坏**（这几个数字从图上消失）；popup **被弹到页面最下面**，压在输入框下、被拦腰截断 | `highlightRange` 把 HTML `<span>` 插进 SVG 的 `<text>` 里，SVG 不渲染它 → 文字消失；SVG 里的 span 没有尺寸，`getHighlightRect` 拿到 0 → popup 定位到错误位置 |

### 第 1 步：列出 ChatGPT 的高风险回答组件

先在真实页面上把各种组件都弄出来（用户批准消息额度，放在一个专门的测试对话里），每种记下 DOM 结构（只记结构和属性，不记正文），存到 `collab/evidence/formats/`。分类：

| 类 | 组件 | 风险点 |
|---|---|---|
| A 文字 | 段落、标题、粗体/斜体、行内代码、链接、表情、中英混排、超长单词/URL | 基线；句子边界 |
| B 列表 | 无序、有序、嵌套、列表项里多段、任务列表；**新步骤卡片**（R2） | 跨项选区重复（R1）、序号是否算进引用 |
| C 引用块 | `>` 引用、嵌套引用 | 块边界 |
| D 表格 | 普通表格、很宽要横向滚动的表格、单元格里有格式；可交互的数据表（数据分析） | 跨单元格选区、句子边界、横向滚动时 popup 定位 |
| E 代码 | 新代码块（标题栏/Run/Copy）、长行横向滚动、行内代码、Canvas | R3：高亮不显示、工具栏文字、换行 |
| F 公式 | KaTeX 行内、独立公式、`\boxed` | 回归（DEBUG #54 已做） |
| G 图形组件 | 图表（折线/柱状/饼图，SVG 或 canvas）、生成的图片、图片搜索结果、地图/地点卡片、天气、股票、体育比分、商品卡片、视频 | R4：插 span 破坏渲染、取不到位置 |
| H 引用来源 | 来源小标签（「+2」）、Sources 按钮、脚注 | 选中时带进小标签文字；标签是按钮 |
| I 折叠/工具 | 「思考了 X 秒」折叠区、工具调用结果、文件下载卡片 | 选到折叠区里的内容；折叠后高亮位置 |
| J 状态 | 正在生成的回答里选字；深色模式；非英文界面 | 回答还在变时插 span |

### 第 2 步：每个组件跑同一套检查

| 检查 | 通过标准 |
|---|---|
| C1 页面高亮 | 选中的字在页面上被高亮，范围不多不少 |
| C2 不破坏原组件 | 布局、渲染、按钮功能不变（图表照常显示、代码块能复制和运行） |
| C3 引用 | 引用里没有重复、没有工具栏/按钮文字，代码保留换行，高亮部分和选区一致 |
| C4 popup 位置 | popup 出现在高亮旁边、在可见范围内 |
| C5 发送后 | 问题文字正确（`JR.buildMessage`），回答在 popup 里显示 |
| C6 刷新后恢复 | 高亮回到原位置（`findTextRange`），点开能看到 popup |
| C7 popup 里显示 | 同类组件出现在 popup 的回答里时，显示得像样（图表这类可能显示不出，至少不能乱） |
| C8 嵌套 | 在 popup 回答里的同类组件上再选字，C1–C4 照样成立 |
| C9 删除 | 删除后组件恢复原样，没有残留 span |

### 第 3 步：离线测试先行

- 把第 1 步记下的 DOM 结构做成 `tools/dom-test.html` 里的固定样例（结构照抄，正文换成假的），对每个样例自动跑 C1、C2（插入 span 前后结构对比）、C3、C6、C9。
- 先让这些测试按现状失败（证明能抓到 R1–R4），再修，再全部通过。

### 第 4 步：修复方向（具体方案用 grilling 跟用户确认后再定）

- **哪里不能插 span**：SVG、canvas、编辑器式的代码区等，不能直接插 span。可选方案：改用 CSS Custom Highlight API（`CSS.highlights`，不改 DOM，也就不会被编辑器重绘删掉）；或者在这些区域里禁止选字建 popup；或者用一层覆盖在上面的高亮框。
- **位置**：高亮没有尺寸时，退回用选区本身的 `getBoundingClientRect`，绝不能定位到 0。
- **引用**：修 R1/R2 的跨块重复；代码块按行取文字、去掉工具栏。
- 每个修复都加离线测试；全部修完，在真实页面上按第 2 步再过一遍，ChatGPT 全面回归（T26 那样）。

## DeepSeek：可行性高，用户已同意按下面的方式做

### 实测结论（P1–P4）
- **虚拟化列表**：容器是 `.ds-virtual-list`，滚动元素就是它，可见范围从 y=60 到输入区上沿。每条消息都是一个独立的 `[data-virtual-list-item-key=N]`，用户消息和回答是相邻的两个元素。
- **用 CSS `display:none` 隐藏**：间距完全收拢，来回滚动约 200 次没有出现空白（P3）。所以**只用 CSS 隐藏**就够了，不需要做网络层过滤，也不需要改写父消息。问答仍然在页面和服务器上，下一条消息自然接在它们后面。
- **身份**：item key 就是服务器上的消息 id，是连续的整数（1 是用户、2 是回答……）。但刚发出时页面先用临时的负数编号（-2、-3），直到刷新才换成真正的 id。真正的 id 来自发送回包的第一帧：`event: ready` 里的 `{request_message_id, response_message_id}`。
- **发送**：`XHR POST /api/v0/chat/completion`，请求体是 JSON，字段有 `chat_session_id`、`parent_message_id`、`prompt`、`ref_file_ids`、`thinking_enabled`、`search_enabled`、`action`、`preempt`。回包是 SSE：先是 `ready`，再是 `update_session`，然后是增量，格式为 `{v}` 和 `{o,p,v}`，和 ChatGPT 的增量格式几乎一样。
- **页面元素**：
  - 输入框只有一个：`textarea[placeholder="Message DeepSeek"]`，没有 `<form>`。
  - 发送按钮是 `div[role=button].ds-button--primary`，没有 aria 名字。生成中，同一个按钮的图标会变成方块（停止）。
- **历史消息**：`XHR GET /api/v0/chat/history_messages?chat_session_id=…&cache_version=…`。对话会缓存在浏览器本地，命中缓存时 `chat_messages` 是空数组。
- **代码块**：`.md-code-block > pre > span`，里面没有 `<code>`。公式还没见到，是否用 KaTeX 待确认。
- **深色模式**：看 `body` 的 class，浅色时是 `light`。

### 实现步骤
1. **重构，不改变 ChatGPT 的任何行为**：
   - 按网址选用哪套适配。
   - 对话 id 规则现在有 3 份（`site-adapter.js`、`storage.js`、`early-hide.js`），合并成一处。
   - 存储键名加上网站前缀：DeepSeek 用 `popup:deepseek:conv:<id>`，ChatGPT 的键名不变，不用迁移。
   - `net-tap.js` 和 `qa-content.js` 里调用 ChatGPT 接口的读回部分，只在 ChatGPT 上运行。
2. **DeepSeek 适配**，例如放在 `src/sites/deepseek.js`：
   - 一轮 = 用户 item 加上紧跟的回答 item。隐藏时两个都藏，对应的选择器分别是 `[data-virtual-list-item-key="N"]` 和 `N+1`。
   - textarea 输入，发送按钮从输入框往上找。
   - 生成中：发送请求还在传回答时就算生成中；按钮图标作为备用判断。
   - 弹窗挂在 `.ds-virtual-list-items` 上，它是整段对话的高度，不会被卸载。
   - 可见范围用滚动区上沿到输入区上沿。
   - 代码块按 `.md-code-block > pre` 识别；深色模式加上对 `body.dark`（待确认）的判断。
3. **DeepSeek 的网络监听**，例如放在 `src/sites/deepseek-net.js`，在页面环境里运行：
   - 拦截 XHR 的 completion 请求，只处理 Popup 格式的问题。
   - 从 `ready` 拿到真正的 id，作为 `turn` 事件发给 Popup，把临时编号对应上。
   - 把增量文字作为 `text` / `done` 事件发出。事件格式和 ChatGPT 的 `jr-net` 一样，`chat.js` 不用改。
4. **读回不在屏幕上的回答**：从内容脚本请求 `history_messages`，看要不要带登录信息，并处理缓存为空的情况。
5. **测试**：
   - 用剩下的 4 条：Popup 提问 → 刷新后恢复 → 在主聊天里问「我上一个 popup 问题是什么」，验证上下文完整 → 嵌套提问。
   - 浅色、深色各看一次。
   - ChatGPT 跑一遍 T26 那样的全面回归。

## claude.ai：可行性中，暂缓，等 DeepSeek 做完再定

- 每轮有 uuid：用户在 `[data-cds=UserMessage]` 上，带 `data-turn-key=<uuid>`；回答是同一个 uuid 加 `-hub-reply`，两者是相邻的 `[data-testid=transcript-row]`。
- 输入框是 `div.tiptap.ProseMirror[data-testid=chat-input]`，发送按钮是 `button[data-testid=chat-input-send]`，没有 `<form>`。
- 也是虚拟化列表。CSS 隐藏能让间距收拢，但滚动经过隐藏区时会**闪一下空白**（P3）；不隐藏就没有（P3b）。
- 对话数据走 `POST /claudeai-rpc/…ConversationService/StreamTimeline`，格式是 connect+proto 二进制。要做网络层过滤，就得改写 protobuf，很脆弱。
- 可选方向：先查清空白是怎么来的。比如 Claude 的列表在估算行高，可以试试用 `height:0; overflow:hidden` 代替 `display:none`，看估算会不会因此变对。实在不行，再考虑改二进制数据。

## popup 里附图提问（ChatGPT）——方案已批准，第 0 步已完成

### 背景

用户想在 popup 里追问时，把图片粘贴（Cmd+V）或拖进输入框，和问题一起发给 ChatGPT。用户已定：
- **范围**：一级 popup 提新问题、编辑已有问题都支持；嵌套 popup 用的是同一个输入框代码，所以自然也支持。
- **数量**：一次可以带多张，上限和 ChatGPT 一样。
- **刷新后**：popup 里显示原图缩略图。
- **网站**：先只做 ChatGPT；DeepSeek 等它的适配做完再接。

**原则不变**：Popup 自己不上传，图片交给 ChatGPT 自己的上传流程，用用户的账号。存储只存 key，不存图片。

### 现状（代码审查结论）

| 位置 | 现在的情况 | 附图要改什么 |
|---|---|---|
| `src/popup.js` `buildInputRow` (~L658) 和编辑输入框 (~L1256) | `paste` 只插入纯文本，图片被静默丢掉；没有 `drop` 处理 | 接收图片文件，显示缩略图条 |
| `doSend` (~L709)、`submitEdit` (~L1179)、重试 (~L1503) | 只把问题文字放进 `JR.enqueueMessage` | 把图片 `File[]` 一起带上 |
| 编辑输入框的发送按钮 (~L1385) | 只在文字改变时才能点 | 加了图或换了图也要能发 |
| `src/chat.js` `injectAndSend` (L204) | 只等发送按钮约 1.8 秒，等不到就判失败 | 上传要几秒，会被误判为发送失败 |
| `waitForResponse` 的被拒检测 (L1175) | 1.5 秒后输入框里还有文字，就清空并重发 | 上传中会被误判成「被拒」，导致清空、重复发送 |
| `waitForResponse` 的快速超时 (L1200) | 发出后 3 秒内没出现新一轮，就判超时 | 同上 |
| `clearComposer` (L51) | 只删文字 | 附件卡片会留在输入框里 |
| `src/net-tap.js` `questionFromBody` (L29) | 只认 `parts[0]` 是字符串的消息 | 带图消息 `parts = [图片, 文字]` 认不出 → 不读流、不改写父消息。改成和 `partsText` 一样只取字符串 |
| `findNewTurns`、`parsePopupMessage`、`textOf`、`partsText`、`filterPage` | 只看文字 | 带图消息照样能认出、能隐藏、能读回文字，不用改 |
| 读回（`src/qa-content.js`） | 从不读图片 | 要按图片指针拿到图片的临时地址 |
| 灯箱 `openLightbox` (popup.js L481) | 标了 CAROUSEL-LOCKED | 不改，直接用对象 URL 调用，现有代码就是这么用的 |

### 方案

### 第 0 步：实测取证（开发开关，先不发消息，最后用 1 条）

不确定的地方都靠实测确认，证据存到 `collab/evidence/img/`：
1. **怎么把图交给 ChatGPT**：开发版加一个网址开关 `#jr-imgtest`，打开页面时自动生成一张小测试图（用 canvas 画），按两种方式放进 ChatGPT 的输入框，不发送：
   - **A**：找到它隐藏的 `<input type="file">`，用 `DataTransfer` 把文件放进去，再触发 `change`；
   - **B**：在输入框上触发合成的 `drop` 或 `paste` 事件，事件里带上文件。

   记录哪种方式会出现附件卡片、卡片怎么判断上传完成、怎么删掉卡片。
2. **上传接口和请求格式**：沿用之前的探针方式，记录上传要调用哪些接口，以及发送请求里图片在 `content.parts` 里长什么样（应该类似 `image_asset_pointer`，带 `file-service://file-…`）。
3. **刷新后怎么拿到图片**：从对话数据里拿到图片的 file id，然后调 `GET /backend-api/files/download/{id}`，预计会返回一个有时效的下载地址。要确认这一点，以及这个地址能不能直接放进 `<img>`。
4. 前 3 项都清楚了，再用 1 条消息测完整的附图提问，确认上面的推断都对。

### 第 1 步：popup 输入框接收图片
- 新加的输入框和编辑输入框都监听 `paste`（`clipboardData.files`）、`dragover` 和 `drop`（`dataTransfer.files`），只收 `image/*`；文字照旧按纯文本粘贴。
- 输入框下面显示缩略图条（新的 CSS 类，例如 `.jr-popup-attach`，按样式指南来），每张图带 ×，点图片用现有的 `openLightbox` 放大。
- 要发送，问题文字仍然不能为空，因为消息格式需要问题。编辑时，文字改了、图加了、图删了，都算有改动。

### 第 2 步：发送时把图交给 ChatGPT
- `JR.enqueueMessage` 的参数里加上 `files`，排队时文件留在内存里。
- `chat.js` 新增 `attachToComposer(files)`，用第 0 步验证有效的方式。新的选择器（文件输入框、附件卡片、上传中的标志、卡片上的删除按钮）都放进 `src/site-adapter.js`。
- `injectAndSend` 的新顺序：
  1. 把整个输入区藏起来，不只是文字框，免得附件卡片闪一下；
  2. 放入图片；
  3. 等上传完成：卡片都在、没有在加载、发送按钮可用。上限 60 秒，超时或出错就报「图片上传失败」，并清掉卡片；
  4. 写入文字，点发送。
- **计时修正**：被拒检测、3 秒快速超时、10 秒超时，都从**真正点下发送**那一刻开始算，不再从排队开始算。`clearComposer` 也会删掉附件卡片。
- `net-tap.js` 的 `questionFromBody` 改成只取字符串部分，和 `partsText` 一致。

### 第 3 步：popup 里显示图片
- **当次会话**：问题上方用对象 URL 显示缩略图。
- **存储**：只加一个计数字段 `images`（几张），沿用 `wholeResponse` 那几处的写法，涉及 `saveHighlight`、`updateHighlightFields`，以及 `popup.js` 和 `chat.js` 里复制条目的地方。不存图片本身。
- **刷新后**：`qa-content.js` 读回时，从这条用户消息里取出图片的 file id，用第 0 步确认的接口拿到临时地址，显示缩略图；这次会话里缓存起来，不重复请求。拿不到时显示「[图片]」占位。
- **编辑**：新版本带它自己的图。切换版本时，缩略图跟着切换。
- **重试**：图片文件还在内存里就一起重发；已经不在了（比如刷新过），就提示用户「编辑问题，重新附上图片」，不会只发文字假装成功。

### 关键文件
- `src/popup.js`：输入框、`doSend`、`submitEdit`、重试，以及显示图片。
- `src/chat.js`：`attachToComposer`、`injectAndSend`、计时修正、`clearComposer`。
- `src/site-adapter.js`：新增文件输入框、附件卡片、上传状态的选择器。
- `src/net-tap.js`：`questionFromBody`。
- `src/qa-content.js`：读回图片。
- `storage.js`：`images` 字段。
- `styles.css`：缩略图条，以及拖进来时的高亮提示。

### 验证
- **单元测试**：
  - `tools/net-tap-test.js` 加带图消息的用例：`questionFromBody` 和 `filterPage` 都要能认出它是 Popup 问题。
  - `tools/qa-content-test.js` 加一个用例：从对话数据里取出图片 file id。
  - `tools/dom-test.html` 加一个用例：在 popup 输入框上触发带图片文件的 `paste` 和 `drop`，检查缩略图条出现，删除按钮能删掉。
- **真实页面**（用户批准消息额度）：
  - 不发消息：第 0 步的输入框测试。
  - 发消息：附 1 张图提问 → 主聊天里看不到，popup 里能看到回答和缩略图；刷新后缩略图还在；编辑问题并换一张图，生成第 2 版，两个版本切换时缩略图跟着变；一次附 2 张图。

  大约需要 4 条消息。
- 最后在 ChatGPT 上跑一遍 T26 那样的全面回归，确认不带图的提问不受影响。

### 风险
- **方式 A 和 B 都不被 ChatGPT 接受**（比如它只认真实的用户操作）：这样就做不了「交给网站上传」，只能改成我们自己调它的上传接口，复杂度和风险都会明显上升。第 0 步就是为了尽早知道这一点。
- **上传失败**（账号额度用完、图片太大）：要有清楚的提示，并且不能只发出文字。
- **刷新后拿图片的地址有时效**：每次打开 popup 时重新拿，不存起来。

### 第 0 步结果（IMG0，2026-10-28，零发送，证据在 collab/evidence/img/）
- **A**（隐藏的文件输入框，设置 `files` 后触发 `change`）：没有反应，没有出现附件，也没有发起上传。
- **B**（合成的 `drop`）：同样没有反应。
- **C**（在 `.ProseMirror[data-composer-markdown]` 上触发合成的 `paste`，`clipboardData` 里带文件）：**成功**。输入框上方出现图片附件卡片，接着调用 `POST /backend-api/files` → `{file_id: "file_…", upload_url}` 和 `/backend-api/files/process_upload_stream`，两个都返回 200，发送按钮变成可用。→ **采用方式 C。**
- 卡片的删除按钮：`button[aria-label="Remove <文件名>"]`。上传完成的信号：发送按钮 `button[aria-label="Send"]` 可用，且附件卡片里没有加载状态。
- 还没测的（要发消息才能看到）：发送请求里图片在 `content.parts` 里的样子；刷新后能否用 `GET /backend-api/files/download/{file_id}` 拿到图片地址。
- 开发开关 `src/dev-imgtest.js`（网址加 `#jr-imgtest=A|B|C`）还没提交，只用于评估，不能打进商店 zip。
- **下一步**：按方案做第 1 到 3 步，然后用约 4 条消息做真实测试，这些消息要用户批准。
