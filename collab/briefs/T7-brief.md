# T7 — commander → operator：附件真实发送（1.2.11-dev.4，用户已批准：这一轮最多 4 条消息）

先刷新并确认 `#jr-diagnostics` 的 version 是 `1.2.11-dev.4`。存 `collab/evidence/s2/t7/`。不改账号设置。截图标准同 T2（只截 popup 和相关区域，popup 完全不透明，PNG）。
只在「Popup 格式测试」对话里发。测试文件：`collab/evidence/s2/test-blue.png`、`test-orange.png`、`test-note.pdf`（用你 T6 的办法：tab.clipboard.write 写入原始字节，再 ⌘V）。

## 0. 不发消息
选一段文字打开 popup，贴进两张图和 PDF：附件是**引用框和输入框之间单独的一层**，一个个大小一样的小方块（图片是缩略图，PDF 是文件图标加「PDF」），popup 跟着变高。截图 `0-strip-above.png`。

## 1. 单张图（第 1 条）
popup 里贴入蓝色图，问 `这张图是什么颜色？只回答颜色。` 并发送。检查：
- 发送前后 ChatGPT 自己的输入框没有闪出附件卡片（尽量观察）；
- popup 里问题上方显示这张缩略图；回答说的是蓝色；主聊天里看不到这条问答；
- 立刻读 `#jr-netlog` 的 data-json，存 `1-netlog.json`（里面有 `request shape`）。
截图 `1-single.png`。

## 2. 两张图 + PDF（第 2 条）
在另一段文字上开新 popup，贴入蓝图、橙图和 PDF，问 `这三个附件分别是什么？各用一句话。`。检查：附件条有 2 个缩略图 + 1 个 PDF 卡片；回答提到蓝、橙和 PDF 里的文字「Popup test PDF」。存 `2-netlog.json`，截图 `2-mixed.png`。

## 3. 编辑并换附件（第 3 条）
打开第 1 步的 popup，点问题进入编辑：输入框上方应该**没有**旧图（编辑从空白开始）。贴入橙色图，把问题改成 `那这张呢？只回答颜色。`，发送。检查：生成第 2 版，回答是橙色；用版本箭头切回第 1 版、再切到第 2 版。截图 `3-edit.png`。

## 4. 上传失败只发文字（第 4 条）
在终端建一个空文件：`: > /tmp/empty.txt`，用你的办法把一个 0 字节的文件贴进新 popup（如果工具只能写字节，就写 0 字节、类型 text/plain、名字 empty.txt），问 `你收到附件了吗？` 并发送。预期：ChatGPT 不接受这个文件，问题照样发出去，问题下方出现灰色小字「1 attachment was not sent: …」。截图 `4-failed.png`。如果 ChatGPT 接受了这个文件，就写明。

## 5. 刷新（不发消息）
刷新页面（遇到 couldn't load 就从侧栏重新进入），然后：
- 读 `#jr-attachlog` 的 data-json，存 `5-attachlog.json`；
- 打开第 1、2 步的 popup，记录问题上方有没有附件（这一版还没做「刷新后显示附件」，预期**没有**，只是记录）。

回报：`python3 tools/board_post.py --from operator --to commander --reply 是 --body "T7 完成：…"`，逐项写通过 / 不通过，用了几条消息。
