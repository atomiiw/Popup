# Regression log

One row per run of [REGRESSION.md](REGRESSION.md). Failed cases: the id and one line on what was seen.

Test conversations: ChatGPT `6afbb274-2044-83e9-8e7d-12b5a352465b` · DeepSeek `ab210d2f-53c2-4aa4-88fb-1b1fa8ea2fad` ·
claude.ai `b405b841-d9b0-4045-8de5-385de0dc2683` (the maintainer's account; on another account create your own,
see REGRESSION.md setup, and write their ids here).

| date | version | who | part A | ChatGPT | DeepSeek | claude.ai | notes |
|---|---|---|---|---|---|---|---|
| **2026-11-18 (summary)** | **dev.74 → 88** | commander + Codex operator | ALL PASS ×3 (dev.88) | **all pass** — B1–B16, C-dark, C-lang (中文), G1. Fixed on the way: B9/B10 send flash in a long chat (dev.81), B8 long-chat native drawing (dev.73), B7 criterion clarified (height changes once). B10 measured per frame (tools/stream-log.js): popup = ChatGPT's text at every update (~240 ms) | **all pass** — B1–B16, D1–D4, C-dark, C-lang (中文). Fixed: B11/B12/B14 main-chat message not drawn after many popups (dev.77), B9 math/code as source (dev.78/79: DeepSeek's own drawing copied from its list), D3 outline "↳" entries + clicks (dev.64–67, 84), search answers (dev.61). B10: popup = DeepSeek's text at every update (~60 ms) | **all pass** — B1–B16, C1–C3, C-dark, C-lang (B2; B9 after dev.88). Fixed: B9 code colours after a reload (dev.83–88), C-dark code readable (dev.82). B13's one 638 px jump not reproduced in two re-runs. B10: popup = Claude's text at every update (~150 ms) | Cases ran across builds while fixing (each fix re-run on its build); one full sitting on the final build was not done before the user's return — the final smoke on dev.88 is the next row. B15 on ChatGPT/DeepSeek used the entries those sites have (ChatGPT Settings is a page). Per-case notes below. |
| 2026-11-18 09:05 (smoke) | dev.88 | Codex operator | ALL PASS ×3 | B2, B7, B9 pass | B2, B7, B9, D3 (one entry) pass · bottom of the chat: once blank (chat and input box) right after the first reload and a fast scroll to the bottom, fine after scrolling up; not reproduced on the next reload nor in a recorded repro (list drew items 20–116, the newest message visible) | B2, B7, B9 pass | Final check on the final build. The one-time DeepSeek blank is open: watch for it in the next run (REGRESSION B12/B14). |
| 2026-11-17/18 | 1.2.13-dev.38–63 | commander + Codex operator | ALL PASS (dev.63) | pass: B1–B9, B13 (b), B15, C-dark, G1 · not run: B10–B12, B13 (a, c), B14, B16, C-lang | pass: B1–B9, B11, B12 (dev.63), B13 (b, c), B14, C-dark, C-lang (English), D1, D2, D4 · **fail: D3** (with popup questions between your own questions the outline shows an empty stretch) · not run: B10, B13 (a), B15, B16 | pass: B2, B4–B9, B11, B13 (a–c), B14–B16, C-dark, C3, C2 · UI was English throughout · not run: B1, B3, B10, B12, C1, C-lang (another language) | Built from the fixes of these two days (REPORTS.md); the cases were run while fixing, not as one sitting. D3 open. |
| 2026-11-18 | 1.2.13-dev.74 | Codex operator | not run | B1–B6 PASS under the updated criteria: cross-line arrow is horizontally centred on the longest selected line; B2–B6 do not require word-by-word streaming. STILL/HIDDEN/SETTLED observed; bottom TLS answer visible with no abnormal blank or leaked popup Q&A. B3 mouse-send, B4 anchored Reply, B5 old/new versions, B6 3/3 first-click nested opening worked. | refreshed only | refreshed only | No additional sends beyond B2–B6. Native CUA timed out twice; recovery did not duplicate sends. Stopped after six requested cases. |

| 2026-11-18 | 1.2.13-dev.74 | Codex operator | not run | PASS B8, B11, B12, B13(a–c), B14, B16; B15 available paths PASS (UI variants noted below); FAIL B7, B9, B10 | not run | not run | Continued native Chrome CUA; B10 recording incomplete due to tool interruptions. |


## Per-case notes (Codex operator, verbatim)

ChatGPT dev.74：已重读 B1 新标准，原箭头横向对准最长行，B1–B6 按更新标准均 PASS。
B7 FAIL：刷新后根/Reply/版本/嵌套均恢复，旧答能加载；但点 ‹ 时先 Loading 小框再向上长大约 85px，未满足“不缩小再长大”。
B8 PASS：近期“计算共享密钥”和最早光合作用高亮均由 Loading 转 ChatGPT 表格/数学字体，随后观察 15 秒未再变样（约数秒加载，未精确计时）。
B9 FAIL：表格宽度、数学字体、代码颜色/头部/缩进及刷新恢复正常；发送瞬间曾主聊天已有正文变空块并跳到后面，下一张恢复（1 次）；宽代码横滚未充分验证。
B10 FAIL：两次长回答；捕获的连续片段约每 1.1 秒渐增几行、向上增长并追尾，手动上滚后观察仍在追尾，未保持阅读位置；发送又见一次主聊天空块/跳转。CUA 中断造成截图缺段，未完成全程逐秒记录，不能认定全部流式标准通过。
B11 PASS：主聊天准确复述最后一条弹窗问题“用三段话详细解释，每段至少八句，讲清楚机制、步骤和例子”，该正常问答可见。
B12 PASS：连续 8 个不同 TLS 短语各问“一句话”均答完；随后主聊天“回归测试：请用一句话概括 TLS 1.3。”及回答刷新后仍正常可见，往返滚动未见空白/Popup 问答露出。
B13 PASS：(a) 未发送，提示 Send or remove your files in ChatGPT’s box first；(b) QUIC“连接标识”带橙图回答“图中是橙色。”，交接时主输入区隐藏、最后干净、原文/高亮位置未变，未见问答露出；(c) 刷新后橙色缩略图和问答恢复。
B14 PASS：从底部上滚 30 下再下滚 30 下（分批截图观察），未见异常大空白、闪烁或 Popup 问答露出；与 B12 往返滚动合并执行。
B15 PASS（现有入口）：3 次 Settings 往返及另一测试对话→返回，高亮均在且可打开回答。本站 Settings 是独立页，无对话侧栏/关闭按钮、Esc 无效；采用浏览器后退、Home 返回后点侧栏、Home 返回替代，原两条入口 N/A，非原样覆盖。
B16 PASS：仅输入“测试菜单”未发送；悬停箭头后 Detailed/Concise 紧贴箭头正下方。已 Esc 关闭，停在测试页。


## 2026-11-18 — DeepSeek dev.76, B1–B8

DeepSeek ab210d2f；已确认 1.2.13-dev.76，刷新；DeepThink/Search 全程关/关。截图为 CUA 对话内观察，未落盘。
B1 PASS：上部向下、下部向上；跨行箭头横向对准最长的第二行，未盖住高亮。
B2 PASS：新选“火山砾”，Return“一句话解释”；主聊天/高亮不动、未见闪空或问答露出，结束10秒不变。
B3 PASS：新选“火山弹”，鼠标点发送箭头“再一句话”；位置稳定，结束10秒不变。
B4 PASS：Reply“更短”正常；根弹窗保持、上层贴着 Reply，主聊天无跳闪，结束10秒不变。
B5 PASS：改为“更短，五个字”；左右箭头能切回旧问题/旧长答和新版短答，主聊天无移动。
B6 PASS：在3个弹窗内分别选“浆团块。”“大熔岩碎块”“态岩浆团块”问“一句话”；3/3第一次点击打开、均答完，主聊天稳定，结束10秒无变样。
B7 PASS：刷新后“火山弹”→Reply恢复，箭头在；旧答点击后即出现（<5秒），每次高度只变一次、未见先缩小；嵌套高亮/回答恢复。底部正常主问答可见，无大空白或Popup问答露出。
B8 FAIL（覆盖未齐，非已发现渲染故障）：近期“岩浆的性质…”立即原生表格，15秒不变，公式为η≈A·exp(E/RT)·f(SiO₂)，代码有Copy/Download；最早光合作用高亮立即显示原生纯文字并稳定15秒，但该弹窗无表格/公式，故最早富文本分支未覆盖，未额外发送造数据。
口径：HIDDEN按主聊天隐藏判定；目录显示↳条目依你之前的用户决定和D3标准，不把它当泄漏（开头Pass words仍写目录也隐藏，与D3冲突）。已Esc关弹窗，停在最早光合作用回答。
另：ChatGPT B7按你最新指示改记PASS，保留此前高度变化事实；B9/B10已知闪烁待你修。


## 2026-11-18 — DeepSeek dev.76, B9–B16 + D1–D4 + C-dark

DeepSeek dev.76，ab210d2f；按更新后的 HIDDEN/D3 口径。B8 改记 PASS（近期富文本通过；最早一个仅纯文字，无最早富文本覆盖）。
B9 FAIL：新选“将水分子分解为氧气、”，指定表格/公式/Python；流式后及刷新重开仍显示 \[2H_2O…\] LaTeX 源码，代码黑白且无 Copy/Download 头；表格宽度与代码缩进正常，宽代码横滚未充分覆盖。
B10 FAIL：两次长回答可见多行成批跳出，非平滑逐词；自动追尾、手动内滚后保持阅读位置、结束10秒稳定均正常。已分段约1.3秒截图，但组间约8秒缺段，非全程逐秒记录。
B11 FAIL（显示时序）：上下文答对“用三段话详细解释，每段至少十句，分析原因和机制”；但这条正常主问答最初未显示，直到B12主消息发送后才出现，不满足正常可见。
B12 FAIL：8个不同火山短语各问“一句话”均完成；随后主发“回归测试：用一句话概括火山形成。”，目录有此条，但刷新、到底、上下往返后主聊天仍不画这条问答，末尾只到B11；未露Popup问答。
B13a PASS：网站输入框橙图上传后尝试Popup发“测试”被阻止，原文提示 Send or remove your files in DeepSeek’s box first，未发送。
B13b PASS：移除网站附件，新选“，并释放 6”弹窗贴橙图问颜色；回答“图中是橙色到棕黄色渐变的纯色背景，没有其他内容。”；交接截图网站输入区隐藏，最后干净，高亮不动，无问答露出。
B13c PASS：刷新重开，橙色缩略图和上述问答均恢复。
B14 FAIL（同B12）：约30下上滚再30下返回，采样未见额外正文空洞/闪烁/Popup泄漏；但底部应有的B12正常主问答仍缺失，NO-BLANK未满足。
B15 PASS（注明覆盖）：Settings→浏览器后退／点击侧栏本测试对话／点×关闭，三次高亮均保留可打开；另用New chat空白页→侧栏回本测试对话，高亮可打开，未访问别人的已有对话；未覆盖另一已有对话往返。
B16 PASS：弹窗只输入“测试菜单”不发送，Detailed/Concise 紧贴发送箭头正下方；已Esc。
D1 PASS：DeepThink开，新选“上覆岩层”问“一句话解释”，弹窗仅最终答案，无Thought for/推理；刷新重开同样正常，已关回。
D2 PASS：Search开，新选“地幔柱”问指定新闻；无Found N web pages，引用为小圆1/4/6；点1新开tv.cctv.com来源标签后已关，刷新仍圆数字，Search已关回。
D3 PASS：目录顶→底逐段看，无Regarding/空白段，Popup均↳问题；点“用五段话介绍火山的形成”正常跳转，点↳一句话解释跳到“上覆岩层”并打开正确弹窗。
D4 PASS：刷新到底，主聊天未见Popup问题气泡（正常主消息缺失另记B12）。
C-dark PASS：System→Dark，表格、引用区、正文、高亮、三层嵌套、版本‹›、输入框与Detailed/Concise均深色可读无白块；已恢复System。
已关闭所有弹窗/设置，停在DeepSeek测试页；DeepThink/Search关/关、输入框无附件。截图仅CUA对话内，未落盘。


## 2026-11-18 — DeepSeek dev.78 targeted retest

dev.78 已重载并确认 1.2.13-dev.78；DeepSeek ab210d2f 刷新等15秒，DeepThink/Search保持关/关。
底部/滚动 PASS：B12“回归测试：用一句话概括火山形成。”及回答现在均可见；回答原文“火山形成于地球内部岩浆上升至地表并喷发的过程，根本原因是局部岩石部分熔融产生岩浆。” 上30下、下30下再到底，分批截图未见异常空白/闪烁/Popup问答露出，主问答仍可见。
旧B9：点“将水分子分解为氧气、”后第一张截图只见引用/问题区，回答区在屏幕下面，未能计出Loading时长；随后滚到回答已是原生表格与数学字体 2H₂O→O₂+4H⁺+4e⁻，无\[源码；代码有python、Copy/Download标题栏和缩进，但正文仍黑白，未见语法配色。
新问：新选火山第三段末“越大。”，06:26:31 ET（11:26:31 UTC）Return“用一个公式和一小段 Python 代码解释”。初始Loading；约7秒后的连续截图已有紫/蓝/绿/橙代码配色，约9秒内结束，随后10秒未变样。完成后内滚确认η≈A·exp(E/RT)·(SiO₂/50)^n为排好数学字体，代码有python/Copy/Download头及缩进；无字面公式源码。
STILL/HIDDEN PASS：从发送到结束+10秒，所选高亮始终约y822，主聊天未跳/闪/露新问答。覆盖限制：首批后到下一批截图有约7秒间隔，生成时公式被自动追尾滚出可视区，未完整捕获公式初次出现，不能声称全程公式渲染已验证。截图仅CUA内，未落盘。
已停在新弹窗的代码标题栏处，未刷新、未再发送；System主题、关/关开关未改。


## 2026-11-18 — dev.79 targeted retest

dev.79 已重载确认 1.2.13-dev.79；两项完成，ChatGPT 用了1条消息。
DeepSeek 旧B9 PASS：刷新15秒后打开“将水分子分解为氧气、”，代码已有紫/蓝/绿/橙语法配色，灰色注释；python Copy/Download头和缩进正常，已Esc。
ChatGPT：刷新后不动等30秒；HTTP/3在上半屏，新选“第三个主要版本”问“一句话”，回答正常完成，Reply可见；结束后再等5秒稳定。
前后截图HTTP/3首行高亮均约y447，QUIC首行约y1355，弹窗贴着高亮，未见主聊天移动或问答露出。
覆盖限制：发送调用返回图像被工具截断，未能核验发送瞬间/完整流式期间的短暂白闪或空块；不能据此判定全程无闪。截图仅CUA内、未落盘。已停住，未刷新。


## 2026-11-18 — claude.ai dev.80 full live regression (operator)

已在 chrome://extensions 重载并确认 1.2.13-dev.80，ChatGPT 6afbb274、DeepSeek ab210d2f、Claude b405b841 三个测试标签均刷新。实际回归仅在 Claude 测试对话执行；Fable 5.2 Low / Manual 未改。原主题 System → Dark → System，恢复已读到 System=1、Dark=0。合计23条实际发送（21条Popup、2条正常主聊天）；B13a测试被阻止，不计发送。截图为CUA对话内观察，未落盘；没有录屏，不能声称全程逐帧无闪。

B1 PASS：量子纠缠回答上部y≈374向下开、下部y≈1303向上开；跨行选区箭头横向居中于较长的第二行，未覆盖高亮。
B2 PASS：刷新10秒，新选“1964年，物理学家贝尔”，Return“一句话解释”；高亮y≈710始终不变，未见主聊天闪/空块/问答露出，完成后10秒稳定；底部正常内容随后B12确认。
B3 PASS：新选“通信，答案是”，输入“再一句话”鼠标发送箭头；高亮y≈945不变，弹窗向上增长，未见闪/泄漏，完成10秒稳定。
B4 PASS：B3底部Reply问“更短”；子弹窗贴着父Reply，父Reply约y851、主聊天位置保持，完成10秒稳定。
B5 PASS：编辑为“更短，五个字”，答“结果不可控。”；‹旧问题“更短”及旧长答、›新版均正常，版本高度各变一次，主聊天稳定。
B6 PASS：在“结果不可”“测量纠缠”“自旋方”三层内分别问“一句话”；3/3第一次点击Popup图标就打开，回答完成10秒稳定、主聊天未见移动/泄漏。
B7 PASS：刷新恢复根/Reply/版本箭头；‹旧答立即出现（<5秒），高度最多变一次、没有先缩小再长大；›新版及嵌套高亮/回答正常，未见泄漏。
B8 PASS（注明覆盖）：近期“寒潮”及最早一条光合作用回答上的“藻类和部分细菌利”均立即显示原生表格/数学字体，随后15秒不变；最早父回答的富文本Popup是本轮B9新建后刷新验证，非历史旧Popup。代码颜色问题另记B9。
B9 FAIL：新选“藻类和部分细菌利”问指定表格/公式/Python；生成时表格横线样式、公式数学字体、代码颜色/Copy/缩进正常，主聊天稳定；刷新重开表格与数学仍正常，但代码正文在观察时变黑白，和主聊天的彩色代码不一致。宽内容横向滚动两次未观察到位移，覆盖未充分，未据此断言横滚故障。
B10 FAIL（含覆盖限制）：两次“用三段话详细解释，每段至少十句”及一次补测“每段至少二十句”，可见Loading之后成批多行出现/跳至后段，非平滑逐词，向上弹窗长大也呈大步变化；自动追尾、完成后10秒稳定。补测内上滚后停在第二段并保持，但动作时Stop恰已消失，不能确认发生于生成中，手动滚动期间不追尾的分支仍未充分覆盖。截图批内约1.3秒一张，批间有缺段，未完成全程逐秒记录。
B11 PASS：主聊天准确复述最后Popup问题（针对代码文档字符串，三段解释、每段至少十句），正常主问答可见。
B12 PASS：暗反应回答连续8个新选区“卡尔文循环或／碳固定／Rubisco／ATP磷酸化／RuBP再生／引发光呼吸／C4植物／CAM植物”各问“一句话”均完成；随后主发“回归测试：用一句话概括光合作用的暗反应。”，问答刷新和上下滚动后可见，无Popup问答露出。回答原文：“暗反应（卡尔文循环）是在叶绿体基质中利用光反应提供的 ATP 和 NADPH，经过碳固定、还原和 RuBP 再生三个阶段，把 CO₂ 转化成糖的过程。”
B13 FAIL（STILL）：a网站输入框橙图时Popup发“测试”被阻止，提示原文“Send or remove your files in Claude’s box first”；b删除网站附件后，新选“是在叶绿”，Popup贴橙图问颜色，答“这张图是纯橙色，整幅没有图案或文字；它和你引用的"是在叶绿"那句没有关联。”，橙色tile在，交接时主输入区隐形、最后干净、未见问答露出；但发送约2秒后高亮从y≈505移至y≈1143（向下约638px），弹窗随高亮移到下方，STILL失败。c刷新重开橙图和问答均恢复。
B14 PASS（采样/步数限制）：从底部慢速滚到最早回答再返回底部，分批截图未见正文空块/闪烁/Popup问答露出，正常主问答仍在。连续滚轮调用触发CUA重置；恢复后明确执行20次上滚、30次下滚，之前中断调用执行的步数不能精确确认，不能声称完整无间断30上/30下。
B15 PASS（现有入口覆盖）：设置→浏览器后退、设置→点左侧“多主题五段介绍”、设置→右上×，各等5秒高亮仍在且可打开；New空白页→侧栏回测试对话，高亮恢复。未访问其他用户已有对话，另一已有对话往返未覆盖。
B16 PASS：弹窗输入两行“今天的新闻？／一句话”，悬停箭头，Detailed/Concise紧贴箭头正下方；深色时同样位置正常。
C1 PASS：上述两行新闻问题实际联网并带4条来源链接，弹窗内只见回答/来源，没有Searched the web/思考状态行，主聊天未露Popup问答，完成10秒稳定。
C2 PASS：刷新15秒重开“个阶段，”高亮，问题区只显示两行“今天的新闻？／一句话”，未出现Regarding包装/长度指令。
C3 PASS：最新消息为Popup新闻、长回答补测后，底部仍只见正常暗反应主回答；回答结束约y1185、主输入框约y1553，中间约300px留白，未见整屏/多屏空白或Popup问答。
C-dark FAIL（代码可读性）：System→Dark；寒潮表格、引用、正文、高亮、箭头、嵌套“单个站点”、‹›版本、输入框和Detailed/Concise均深色可读无白块；但寒潮代码块普通变量/标点近黑色，深背景上难读（紫色关键字/绿色字符串等部分有色）。已恢复System并确认选中，未改其他设置。

收尾：全部弹窗已Esc关闭，输入框无附件，主题System，停在Claude测试对话；未修改扩展代码，等待commander。


## 2026-11-18 — dev.83 C-dark / C-lang supplemental live regression (operator)

Six actual Popup messages (two per named test conversation); no other messages. Screenshots observed inline in CUA, not saved as files. Observations are discrete screenshots, not continuous frame recording; short transient flashes between samples are not ruled out.

ChatGPT C-dark PASS (coverage note): original Theme System → Dark → System, selection restored and verified. Shared-key popup table, mathematics, colored Python, text, quote, highlight, arrows and input readable with no white blocks. Old/new version arrows worked. Nested draft popup opened on first click, dark quote/input/arrow readable; Detailed/Concise menu dark and beneath arrow. Nested coverage was an unsent draft, not a new nested answer; draft cleared.
ChatGPT C-lang PASS (sampled): original Auto detect → 简体中文 → Auto detect, English controls confirmed restored. B2 selected “客户端则利用”, asked “一句话解释”; B9 selected “私钥”, asked specified table/formula/Python prompt. Highlight stayed around y925, no main-chat leakage/blank seen; completed +10 seconds stable. Native table, a/b and A=aG/B=bG/S=abG mathematics, colored Python/copy/run controls seen. Refresh restored native answer. B9 was already complete by first sample, so full streaming render not covered; horizontal code-scroll attempt showed no clear change and is not a verified horizontal-scroll pass.
DeepSeek C-lang PASS (sampled): original System → 简体中文 → System; settings explicitly showed Language System and English controls after restore. DeepThink/Search left off/off. B2 “溢流式” asked “一句话解释”; B9 “泥石流” asked specified rich-text prompt. Highlight stable (B2 y620, B9 y733), no main-chat leakage/blank seen, completion +10 seconds stable. Native horizontal-rule table, rendered Q=A·v and Manning powers, colored/indented Python with 复制/下载. Refresh reopened native table/math/colored code, including indented return. Main bottom normal regression question/answer remained visible; no Popup Q/A exposed. Answers completed before first screenshots, full streaming render not covered.
Claude C-lang FAIL (B2 PASS; B9 reload code color FAIL): original English (United States)=1 → 中文（简体） → English (United States)=1, verified. B2 selected “卡尔文循环”, asked “一句话解释”; B9 selected “光反应提供”, asked specified rich-text prompt. Both completed; main highlight y1134 stayed fixed, no leak/blank seen, +10 seconds settled. During B9 generation and immediately afterward code was colored and indented, native table/horizontal rules and typeset chemical equation seen. After refresh/reopen (~7 seconds then inspection), table/math remained native, long formula moved horizontally when scrolled right, but Python became black monochrome (including print, strings and comments) instead of its previous colored syntax. This repeats the refresh-only code-color failure on the newly created Chinese-interface answer. No raw LaTeX or literal ** seen. Closed popup and restored original language. Stopped on ChatGPT test conversation, no draft/attachment left.


## 2026-11-18 — dev.88 final smoke (operator)

dev.88 最后一轮冒烟完成（按当前 REGRESSION 标准；B7 本轮范围为刷新后的 Reply 与 ‹ ›；共发送 6 条 Popup 问题，未发主聊天消息）。
Claude B2 PASS：新选「无法再把它拆成」问一句话解释；主聊天/高亮位置未变，未见露出或正文空块，完成后10秒稳定。
Claude B9 PASS：新选「源于 1935 年的一」；刷新重开后原生细横线表格、排好的纠缠态公式、彩色 Python/缩进/复制按钮均在，无源码星号；表格使用弹窗宽度。
Claude B7 PASS：「局部跌幅超过12℃」原问题→Reply；‹显示「再短一点」旧长答，›显示「再短一点，十个字以内／先暖后遇强冷空气。」；均约2秒内可见，高度每次只变一次，未见先缩小。
DeepSeek B2 PASS（发送项）：新选「足够的热量」；回答正常、主聊天原位、未见问答露出，完成后10秒不变；底部异常另列。
DeepSeek B9 PASS：新选「大陆裂谷，板」；刷新后原生横线表格、T岩石 > T固相线(P)数学字体、彩色def/return/注释/缩进及Copy/Download头正常。
DeepSeek B7 PASS：光能高亮→Reply；‹旧问题「再短一点」与旧长答约1秒内出现，›新版「再短一点，十个字以内／可见光能，由色素吸收。」正常；未见先缩小再展开。
DeepSeek 底部 FAIL（NO-BLANK）：首次刷新等10秒后向下滚30页到最底，聊天区连同输入区整块空白，额外等5秒仍空白；上滚2页正文恢复。B9后再次刷新和最终滚到底时，最新正常主问「回归测试：用一句话概括火山形成。」及答「火山形成于地球内部岩浆上升至地表并喷发的过程，根本原因是局部岩石部分熔融产生岩浆。」均可见，无Popup问答露出。
DeepSeek 目录条目 PASS：右侧展开可见干净「↳ 一句话」等；点一个条目后主聊天跳到火山原文并打开旧黏度公式/代码弹窗，未见Regarding。此项只检查一个条目，未重新遍历全目录。
ChatGPT B2 PASS：新选「端验证成」；回答正常、主聊天与高亮保持原位、未见空块或问答露出，完成后10秒不变。
ChatGPT B9 PASS：新选「但这些数据存在」；刷新后Loading→回答在5秒采样内完成；原生横线表格、盒装数学公式N执行=1+N成功重放、彩色Python及Run/复制头、缩进正常。
ChatGPT B7 PASS：QUIC「证书等握手信息」→Reply；‹旧「更短」及旧答立即出现，›「更短，五个字／验证服务器」正常；高度最多变化一次，未见先缩小/主聊天移动。
说明：以上为原生CUA截图采样观察，非逐帧测量；宽内容完整横滚未专项重测。输入typeText未落字后改用原生粘贴，无重复发送；CUA中断恢复后核对状态。已Esc关弹窗，停在DeepSeek底部，不再操作。
