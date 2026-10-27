# Popup 修复计划

> 证据来源：operator 在用户已登录的 Chrome 里的实测（`collab/evidence/` T1–T1d、T4），以及对原始代码（GitHub `atomiiw/Popup` main）的三路逐行审计。行号指原始代码。
> 批准后：本文件替换 `collab/PLAN.md`，删除 `collab/TEST-PLAN.md`（内容已并入下面的验证表）。
> 前置事项：上一轮我已改动了 `storage.js`、`src/early-hide.js`、`src/jr-namespace.js`、`src/dom-helpers.js`，并新增了 `src/site-adapter.js`、`src/qa-content.js`，代码处于半迁移状态（文件夹没有 git）。实施第一步是从 GitHub main 恢复原文件，再按本计划重做。

---

## 1. 让代码兼容新版 ChatGPT DOM

**问题与目标：** ChatGPT 改版后 Popup 依赖的页面标记全部消失，扩展在第一步（判断选中的是不是 AI 回答）就静默失败，划字后什么都不发生。改造后整条链路（选中 → popup → 注入发送 → 隐藏问答 → 流式显示 → 刷新恢复 → 嵌套）在新页面上全部恢复，并且今后再改版时扩展会明确告诉用户哪里接不上，而不是静默失效。

### 诊断

**结构变化本身。** Popup 的每一个功能都建立在三条对旧页面的假设上：(a) 每条消息是一个 `[data-testid="conversation-turn-N"]` 元素，N 是全局递增的整数；(b) `querySelectorAll` 得到的 turn 顺序和数量就是整段对话的顺序和数量；(c) 一个 turn 只含一个角色（`data-message-author-role`），所以"问题 turn 的下一个就是回答 turn"。实测新版三条全部不成立。turn 现在是 `[data-turn-key=UUID]`，**一个 turn 同时包含用户问题和 AI 回答**。角色要到内部的 `[data-content-search-unit-key$=":user"|":assistant"]` 才能区分。回答正文是 `[data-markdown-text-style="assistant-message"]`，部分回答改用 `DilRenderer [data-dil-message-id]` 渲染，结构未知。另外：`fallback-turn-N` 编号在加载更多历史后会从 1 变成 24，不能当 id；UUID 刷新前后稳定。

**虚拟化。** 对话列表被虚拟化了：同一时刻只有 4–8 个 turn 在 DOM 里，滚出视口的 turn 被整个删除，滚回来时重新创建为全新节点。后果有：
- Popup 包在原文上的高亮 span 一卸载就丢，而且没有任何代码会重新套上。`restoreHighlights` 只在加载后 15 秒内按 turn 编号轮询 30 次；`highlight.js:432` 跳过已在内存里的条目，所以持有失联 span 的条目永远不会再恢复。
- L1 popup 挂在 `turn.parentElement` 上（`popup.js:585`、`highlight.js:448`、`chat.js:701`）。在新 DOM 里这个父节点是带 `style="height:311px"` 的虚拟化插槽，属于 React，于是：
  - popup 会随插槽一起被删除，`st.activePopup` 仍指着已失联的节点，流式内容无处可写；
  - popup 被插槽高度裁剪，或被后面的插槽盖住；
  - `positionPopup` 写在插槽上的 `position:relative` 可能被 React 重置；
  - `bestDirection`/`checkStreamingOverflow` 把单个插槽的 `scrollHeight` 当成整个可滚动空间，上下翻转的判断全部失真。
- 通过失联 span 打开 popup 时，`resolveContentContainer` 仍能 `closest()` 到失联的 turn，popup 被挂到 DOM 之外：用户看不见，但状态里认为它开着。
- 导航箭头、`openHighlight`、`transitionTo`、搜索都依赖 `spans[0].scrollIntoView()`，对已卸载的 turn 没有任何办法定位，也就无法跳过去。

**发送链路逐段失效。**
- **输入框**：
  - `injectAndSend` 只认 `#prompt-textarea`（`chat.js:83`），找不到就打印一行错误后返回，**界面上没有任何提示**。
  - 新输入框是 ProseMirror `[data-composer-markdown]`，并且页面里同时存在多个**隐藏副本**（SPA 页面缓存）。简单换选择器可能命中隐藏副本，文字注入到看不见的编辑器里。
  - 隐藏注入文字的 CSS 写死了 `div:has(> #prompt-textarea)`。
- **发送按钮**：只在有文字时出现，标记只剩 `aria-label="Send"`（没有 testid，大概率随界面语言变化）。`findSendButton` 的四个候选全部不匹配，重试 20×150ms 后放弃。
- **生成中判断**：`isGenerating`、停止按钮拦截器、超时强停都认 `stop-button` testid。新版停止按钮标记尚未观察到（需要真发消息才能看到）。一旦失配：
  - `isGenerating` 永远为 false，消息队列不再排队，多条问题会重叠发送；
  - 流式一开始就被当成"已结束"而提前截取；
  - #32 的"停止按钮会让问题出现在主聊天"问题会复发。
- **原有 bug（与改版无关）**：10 秒硬超时里的 `stopBtn.click()` 会被扩展自己的捕获阶段拦截器吞掉（`chat.js:25-32` 与 `:1136`），ChatGPT 继续生成；随后 `drainQueue` 在不检查是否生成中的情况下立刻发下一条，超时连锁发生。

**捕获与隐藏完全依赖"数 turn"。**
- `turnsBefore = querySelectorAll(turn).length` 数的是**当前挂载**的 turn 数。滚动时这个数会变，新 turn 挂载的同时顶部 turn 卸载，总数可能不变。
- `allTurns[turnsBefore]` 被当成问题、`[turnsBefore+1]` 被当成回答。新版问答在同一个 turn 里，所以回答 turn 永远找不到，流式永远不开始，10 秒后存成"Couldn't get a response"，而回答其实已经出现在主聊天里。
- 更危险的是，`enforceHidden`（`chat.js:1006`）每次轮询都按下标重新取元素加 `jr-hidden`，`saveTimeoutVersion`（`:565`）把下标之后的所有 turn 隐藏并永久记为"已删除"。用户一滚动，这两处就会**隐藏用户自己的真实对话**。
- `freezeChat` 通过预测"下一个编号"来防闪烁，UUID 无法预测，于是直接退出，注入的问题会在主聊天里闪一下。
- `lockScroll` 每帧把滚动位置钉回原处，只把滚轮/触摸算作用户滚动：
  - 新 turn 出现在对话最底部，用户停在上方阅读时，它可能**根本不会被虚拟化器挂载**，Popup 也就拿不到回答。这是本次最大的未知风险，必须真发消息实测。
  - 它还会和虚拟化器自己的滚动修正互相拉扯。
- 流式用的 MutationObserver 挂在 turn 节点上，节点被卸载后就再也收不到更新。"内容 10 秒未变就强制截取"会把被卸载 turn 冻结的旧文本当成完整回答。

**其他依赖旧 DOM 的地方。**
- 早期隐藏（`early-hide.js`、`refreshEarlyHideStyle`）、`hideDeletedTurns`、`enforceHiddenTurns`、`proxyClickToHiddenTurn`（popup 里点链接要转发给原回答）都按 `conversation-turn-N` 查找。
- "重新隐藏"观察器挂在 `[role="presentation"]` 上，新版这个属性在**输入框**上，等于在监听输入框。
- 布局类函数（标了 LAYOUT-LOCKED）都先找 `react-scroll-to-bottom` 再退回 `main`。新版有 **3 个 `main`**（隐藏副本），若取到隐藏的那个：`isRightSidebarOpen` 恒为真，导航控件永远隐藏，`maxRight` 变成负数，ResizeObserver 监听的是一个死元素。导航控件的滚动监听退回到 `window`，而 `window` 收不到内部容器的滚动事件。
- 深色模式样式写的是 `html[class*="dark"]`，新版 `<html>` 是 `class="chatgpt-theme" data-theme="light|dark"`，深色样式很可能已失效。
- 回答里的富内容结构全变了（T4 实测）：
  - 代码块不再有 `<pre>`，变成 `[data-code-block] > [data-code-block-source] > code`，复制按钮在 `[data-code-block-controls] button[aria-label="Copy code"]` 里。依赖 `pre` 和 `.contain-inline-size` 的地方都会失效：`rebuildCodeBlocks`、`BLOCK_TAGS` 里的 `PRE`、"代码块整块作为句子"的规则、恢复时跳过工具栏文字。
  - 引用变成真正的 `<a data-testid="chatgpt-citation">`；普通外链带 `data-inline-mention-interactive`；`entity-underline` span 没有观察到。
  - 生成图片包在 `button[data-testid=generated-image-preview]` → `[data-web-image-tile]` → `generated-image-gallery` 里。
  - 部分回答由 `DilRenderer [data-dil-message-id]` 渲染，块结构未知。
- 原生 "Ask ChatGPT" 选区按钮仍然存在，文字仍是 "Ask ChatGPT"，但已经不在 `[popover]` 里，而是在 `position:fixed; z-50` 的容器中。所以非英文界面用的结构兜底（要求在 `[popover]` 内）失效；隐藏逻辑 `closest('[popover],[style*="position"]')` 可能隐藏错元素。每个回答正文都带 `data-selected-text-overlay-target`，ChatGPT 自己的选区浮层和 Popup 的 mouseup 处理谁先谁后、会不会互相干扰，还需要实测。
- ChatGPT 新增了自己的对话内查找（`data-thread-find-target`、`data-thread-find-skip`、`data-content-search-*`），和 Popup 的搜索栏可能在快捷键和视觉上冲突。
- 已确认的好消息：
  - 用户消息气泡是 `div.whitespace-pre-wrap` 里的**纯文本节点，换行就是 `\n`**。旧 Popup 消息的直引号、`Specifically:` 都原样保留，回答和问题在同一个 turn UUID 下，所以从消息反解问题在格式上可行。
  - 输入框共 2 个，隐藏的那个有祖先 `display:none`，用尺寸可以区分（`hidden`/`inert` 属性区分不了）。
  - turn 往上的祖先链里有一个 `div.relative.shrink-0`，高度等于整段对话的虚拟总高度（46171px），在虚拟化插槽之上、不会被卸载。

**选区判定。**
- `getAIResponseArticle` 返回 null，触发按钮根本不会出现。
- 即使只换掉 turn 选择器，由于问答同 turn，用户选中**自己的问题**也会被当成 AI 回答，跨问答的选区也能通过"同一 turn"检查。
- 从 mouseup 到点击触发按钮之间，如果 turn 被重新挂载，克隆的 Range 会塌缩，popup 会挂到第一个挂载 turn 的插槽上。

**仍需实测的未知项**（只读手段做不到，需要真发测试消息）：
1. 停止按钮的标记，以及 `data-talvt-turn-state` 在生成过程中会取哪些值；
2. 用户停在上方时，最底部的新 turn 会不会挂载；
3. 被 `display:none` 的 turn 会不会被卸载，所在插槽会不会留下空白高度；
4. turn 刚创建时的 UUID 是不是临时值，服务器返回后会不会被替换（决定流式期间保存的 key 刷新后还认不认）；
5. 在同一个 turn 里，用户部分和回答部分是先后挂载还是同时出现。

### 技术方案

| # | 步骤 | 内容 |
|---|---|---|
| 1.0 | 恢复 + 测试对话 | 从 GitHub main 恢复原文件；征得用户同意后建一个「Popup test」对话，由 operator 实测上面 5 个未知项，结论写进看板 |
| 1.1 | 适配层 `src/site-adapter.js` | 所有 ChatGPT DOM 知识集中在一个文件：每个钩子（turn、角色单元、回答正文、用户正文、输入框、发送、停止、生成状态、滚动容器、popup 宿主）配一组候选选择器（新 → 旧），记录命中的是哪一个；输入框和按钮只认**可见**的那个；其他文件不再出现任何 ChatGPT 选择器 |
| 1.2 | turn 身份改为 UUID | `getTurnNumber` → `getTurnKey`（`data-turn-key`）；所有"按下标/数量"的逻辑改为"发送前记下已有 key 集合，发送后出现的、位置在其后的新 key"，并用 user 文本与注入内容比对确认 |
| 1.3 | 选区判定 | 必须落在 assistant 单元内（不是"在某个含回答的 turn 内"）；选区跨单元时拒绝 |
| 1.4 | 注入与发送 | 找可见输入框 → 写入 → 校验文字确实进去了 → 发送按钮 / Enter / `form.requestSubmit()` 依次兜底 → 校验输入框已清空；每一步失败都返回明确的阶段（找不到输入框 / 写不进 / 发不出） |
| 1.5 | 生成状态 | 停止按钮（多候选）+ turn 状态属性双信号；修掉"强停被自己拦截"的旧 bug；`drainQueue` 前检查是否仍在生成 |
| 1.6 | 防闪烁与隐藏 | freeze 改为 MutationObserver 同步拦截新 turn（回调在绘制前执行）；隐藏统一用一张按 UUID 生成的 CSS 规则表，turn 被卸载重建后自动生效，去掉按下标加 class 和轮询 |
| 1.7 | 捕获与流式 | 新 turn 内的 assistant 正文作为流式源；turn 被卸载时观察器能重新找到同 key 的新节点；"内容不变就强制截取"只在节点仍挂载时生效 |
| 1.8 | 虚拟化下的高亮 | 一个挂在滚动容器上的观察器在 turn 挂载时按 `sourceTurnKey` 重新套高亮，替代 15 秒轮询；入口（点击、导航、搜索）对未挂载的高亮给出降级行为而不是挂到失联节点 |
| 1.9 | popup 宿主与布局 | L1 popup 挂到 T4 发现的全高度 `div.relative.shrink-0`（在虚拟化插槽之上、不会被卸载），通过适配层定位；布局函数改用适配层的滚动容器和可见的 `main` |
| 1.10 | 链接 / 代码块 / 图片 / 原生按钮 | 按 T4 结构更新：代码块识别 `[data-code-block]`（不再依赖 `pre`），句子提取把它当整块；引用 `<a>` 直接打开、`proxyClickToHiddenTurn` 改按 turn key 查找；图库识别 `generated-image-preview`；原生按钮改为"`fixed` 容器内、文字含 ChatGPT"识别，只隐藏这个按钮自己的浮层；深色模式改认 `data-theme` |
| 1.11 | 自检与诊断桥 | `JR.diagnose()` 报告每个钩子命中情况；结果写进隐藏节点 `#jr-diagnostics`（operator 只能读 DOM）；钩子缺失时页面角落显示可关闭的提示；发送失败时 popup 里写明失败在哪一步并撤销隐藏 |

### 验证方法

| # | 标准（全部由 operator 在用户 Chrome 实测，证据存 `collab/evidence/`） |
|---|---|
| V1.1 | 新对话页、老对话页顶/中/底，`#jr-diagnostics` 报告所有钩子命中，输入框恰好 1 个且可见 |
| V1.2 | 用 `JR.diagnose({break:"composer"})` 模拟失效，页面出现提示；popup 发送显示"没发出去"，没有任何 turn 被隐藏 |
| V1.3 | 选中 AI 回答 300ms 内出现触发按钮；选中用户自己的问题、或跨问答选中，都不出现 |
| V1.4 | 发送后主聊天里看不到注入的问答（逐帧截图无闪现），popup 流式显示并最终完整 |
| V1.5 | 用户停在对话顶部时发送，回答仍被完整捕获；或者如果确认做不到，popup 明确提示原因 |
| V1.6 | 连续发两个 popup 问题，按顺序完成；生成中点停止按钮无效（#32 行为保持） |
| V1.7 | 刷新后：高亮回来，问答仍隐藏，点击高亮打开的 popup 内容正确 |
| V1.8 | 滚到顶再滚回，之前的高亮在 turn 重新挂载后回来，隐藏的问答不闪现 |
| V1.9 | 嵌套 3 层、编辑出新版本、级联删除、颜色、Reply、链接点击、代码块复制、图片轮播都与旧版行为一致 |
| V1.10 | 打开右侧面板、收起左侧栏、切换深色模式时，popup / 箭头 / 导航控件位置正确 |
| V1.11 | 切到别的对话再回来，高亮和隐藏都正确，不串到别的对话 |
| V1.12 | 除 `src/site-adapter.js` 外，代码里 grep 不到任何 ChatGPT 选择器 |

---

## 2. 重新设计存储与读取

**问题与目标：** 现在每个问题都把完整回答 HTML 存进一个跨所有对话的全局数组，每次读写都是整存整取，而且页面上还有几个随问题数增长的全页观察器，问到十几个以后页面明显卡顿。改造后只存定位用的 key，内容从 ChatGPT 自己的对话里读回来，并且页面开销不再随问题数增长。

### 诊断

**存的是什么。** 所有对话的所有高亮存在同一个 key `jumpreturn_highlights` 下，是一个数组，按 `url` 精确匹配过滤，从不清理，也没有申请 `unlimitedStorage`（上限 10MB，写入不 await，超限会静默失败）。每条记录是高亮的一个版本，包含：
- 内容：完整的 `responseHTML`（ChatGPT 渲染后的 innerHTML，带大量 class、代码高亮 span 和 `data-start/end` 属性，估计是纯文本的 2–10 倍，单条 10–40KB），以及每个版本都重复存一份的 `text`、`sentence`、`blockTypes`、`question`；
- 位置：`questionIndex`、`responseIndex`、`sourceTurnIndex`（都是整数 turn 编号，新版已不存在）；
- 状态：没有独立字段，用 `"__PENDING__"`/`"__TIMEOUT__"` 两个特殊字符串占用 `responseHTML`。

**怎么读写。** 每个存储函数都先 `getHighlights()` 读出**全部对话的全部记录**，修改后再整体写回：
- 一次"发送 → 流式 → 捕获"约 5 次全量读、4 次全量写，另加 2 读 2 写的已删除 turn 表；
- 每次打开 popup 都无条件 `setActiveItem`，即一次全量读写；每切一次版本也是；搜索跳转时每 350ms 一次。

这些都在 content script 里运行，和 ChatGPT 共用主线程，所以每次读写都在 ChatGPT 渲染的同一线程上拷贝整个存储。问题越多、对话越多，每次的成本越大。这部分**印证了用户的判断**，但它只造成发送、打开、切换那一刻的卡顿。

**读写之间有竞争。** 所有修改都是"读 → 改 → 写"，没有串行化：
- 一次轮询常同时发出两个 `updateHighlightFields`/`addDeletedTurns`，后写的覆盖先写的；
- 捕获过程中打开 popup 触发的 `setActiveItem`，可能用旧快照覆盖刚写入的回答；
- 两个标签页会互相覆盖。

另有一个与改版无关的数据损坏 bug：编辑问题时，`chat.js:1049-1083` 把新 turn 编号写到了**旧版本**的记录上。`updateHighlightColor` 从未被调用，颜色修改实际上不会持久化。

**真正让页面持续变慢的是观察器和轮询**，它们的开销随页面大小和隐藏问答数增长，并且在 ChatGPT 流式生成时几乎每帧触发：
1. "Ask ChatGPT" 按钮观察器（`content.js:1060`）监听整个 `document.body` 的子树。每次变动后的下一帧对全页执行 `querySelectorAll('button')` 并逐个读 `textContent`。流式时约 60 次/秒；按钮数随 turn 数增长，隐藏的问答 turn 也算在内。
2. popup 流式镜像每帧把整段回答 `cloneNode(true)` 再整体替换（单条回答内 O(n²)），随后读 `offsetHeight` 强制回流。同时 `lockScroll` 每帧在 DOM 写入后立即 `getBoundingClientRect`，造成布局抖动；每次替换又会再触发第 1 项。
3. 隐藏 turn 守卫（`highlight.js:493`）每 100ms 对每个隐藏编号做一次全文档查询。每个问题对应 2 个编号，15 个问题约 300 次查询/秒。
4. 导航控件的滚动监听没有节流，每次滚动对每个 L1 高亮读 rect 和祖先的 `getComputedStyle`。ChatGPT 生成时会自动滚动，所以它也是持续触发。
5. 每次刷新都把 `findTextRange` 的全文本节点遍历（含 5 轮全长兜底匹配）重复 30 次。
6. 此外还有 500ms 的 URL 轮询、300ms 的队列轮询、3s 的 ResizeObserver 重挂。

问答本身还会让 ChatGPT 的 DOM 和上下文持续变长：每个问题在真实对话里加一个长 turn，"回复整段"会把整段回答原文再发一遍。

**只存 key 的约束。**
- 内容确实都还在 ChatGPT 里：注入的问题有固定格式（`Regarding this part of your response:` … `Specifically: "…"` … `(For this response only: …)`），问题、引用句、高亮原文都能从用户消息里反解出来。但现有格式有 3 种长度后缀，"回复整段"有 2 种写法，重试路径的 medium 后缀与主路径不一致，问题文本本身也可能包含引号或分隔符，反解存在歧义。
- 回答内容只有在对应 turn **挂载时**才能从 DOM 读到。Popup 的问答都排在对话末尾，用户在顶部打开 popup 时它们通常不在 DOM 里。依赖内容的功能都受影响：popup 正文、嵌套子高亮的恢复（要在父回答里做文本匹配）、搜索全部 popup、"回复整段"。
- ChatGPT 自己的对话接口能拿到全部内容，但它是未公开接口，需要会话 token。operator 的浏览器工具只能读 DOM，没法验证这个接口，只能在扩展内部测试。
- `blockTypes`（引用块的项目符号/粗体渲染）无法从消息里恢复。
- 用户在 ChatGPT 里编辑更早的普通消息会让对话分叉，问答 turn 会离开当前分支。只存 key 时这些内容会"消失"，而以前存的 HTML 还在。
- 旧用户的存量数据只有失效的整数编号，必须靠内容（注入格式 + 高亮原文）重新对应到 UUID，否则这些问答会全部出现在主聊天里。
- 按特征认出 Popup 消息，也存在误把用户自己写的同样开头的消息隐藏掉的理论风险。

### 技术方案

| # | 步骤 | 内容 |
|---|---|---|
| 2.1 | 新存储结构 | 每个对话一个 key `popup:conv:<id>`，只存 `id/quoteId/parentId/parentItemId/text/color/sourceTurnKey/turnKeys/status/active/wholeResponse/createdAt` 和 `hidden[]`；状态用独立字段；不存 HTML、问题、句子 |
| 2.2 | 串行化写入 | 所有写操作走一条 promise 链，并在内存中缓存当前对话文档；监听 `storage.onChanged` 让其他标签页的修改使缓存失效；打开 popup 时只在激活版本真的变化时才写 |
| 2.3 | 统一消息格式 | `buildMessage` / `parsePopupMessage` 成对放在一处，所有发送路径（发送、编辑、重试、回复整段）共用；修正重试后缀不一致；解析对引号/分隔符做容错 |
| 2.4 | 内容读取 | 会话级内存缓存（不落盘、切换对话即清空）：问答 turn 每次挂载、或捕获完成时把内容放进缓存 → 缓存没有就读挂载中的 turn → 都没有就显示"加载中"，等 turn 挂载后自动补上；ChatGPT 对话接口作为扩展内部的可选兜底，先由诊断桥测可行性再决定 |
| 2.5 | 迁移 | 首次运行把旧全局数组按对话拆分；旧整数编号保留为 `legacy` 字段；页面上遇到符合注入格式且高亮原文匹配的 turn 时补写 UUID；原数据保留一份备份 key，下个版本删除 |
| 2.6 | 去掉随规模增长的开销 | 原生按钮观察器改为只在选区出现时检查局部；流式镜像改为增量（只追加/替换变化的块），每帧最多一次布局读取；删除隐藏守卫和下标轮询（由 1.6 的 CSS 规则取代）；导航滚动监听节流并缓存 rect；恢复改为事件驱动（1.8） |
| 2.7 | 性能计数 | 诊断桥输出各观察器回调次数/秒、存储读写次数与耗时、`getBytesInUse` |

### 验证方法

| # | 标准 |
|---|---|
| V2.1 | 20 个问答后，`chrome.storage.local` 里该对话的记录 < 20KB，并且不包含任何 HTML 或问题文本 |
| V2.2 | 一次发送 → 捕获全过程，存储读写合计 ≤ 4 次，每次只涉及当前对话的 key |
| V2.3 | 快速连续操作（发送中打开 popup、切换版本、改颜色）后刷新，所有字段都是最后一次操作的值 |
| V2.4 | 刷新后打开任意 popup：问题、引用、回答与刷新前一致；在顶部打开、回答尚未挂载时，显示"加载中"并在回答可得后自动补全，不出现空白或报错 |
| V2.5 | 嵌套子高亮在父回答从缓存/DOM 取回后能正确恢复 |
| V2.6 | 用旧格式数据（含 15 条记录的样本）加载：不报错；能对上的高亮恢复，旧问答被认出并隐藏；备份 key 存在 |
| V2.7 | 20 个问答的对话里流式生成期间：主线程长任务总时长比 5 个问答时增长 < 20%（证明开销不再随问题数增长） |
| V2.8 | 同一对话中，打开 popup 到可见 < 100ms；滚动 10 屏时，超过 50ms 的帧间隔 < 3 次 |
| V2.9 | 编辑问题后旧版本的 turn key 不被改写（修复数据损坏 bug 的回归测试） |
