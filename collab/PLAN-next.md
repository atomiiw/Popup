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
