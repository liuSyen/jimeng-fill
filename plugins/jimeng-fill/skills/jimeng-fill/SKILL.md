---
name: jimeng-fill
description: 把分镜提示词、参考图和推荐秒数填进即梦（jimeng.jianying.com）。用户说“填即梦”时立刻调用 jimeng_guide。用会话内 MCP 表单（单选 + 确认）展示已读内容和选项；不弹系统窗、不打开浏览器。读入后必须把分镜内容显示在表单说明里。用户明确说生成之前不点击生成。
---

# 即梦填图词

用官方 Codex 的 skill + MCP 服务 `jimeng` 操作即梦视频编辑器。承接浏览器插件「即梦分镜图词助手」v0.1.13。默认不点击生成。

独立 Chrome：`~/.codex/jimeng-chrome`，调试端口 `127.0.0.1:9333`。第一次需在该窗口登录即梦。

## 唯一入口

用户要填即梦时，**立刻只调用** `jimeng_guide`（可无参），然后等到它返回。

- 优先弹出**会话内表单**：上方说明（含已读分镜内容），中间单选项，底部确认。用户点选后点确认继续。
- 不弹 macOS 系统窗，不打开浏览器 / localhost 网页。
- 第一步表单里选「选择分镜文档」会弹出系统文件选择器；也可填路径或粘贴全文。秒数表、参考图文件夹同理。
- 若返回 `mode: "chat"` / `awaiting: true`，把 `message` 贴进对话，等用户回复后再带 `reply` 或 `path` 调用一次。

工具返回后，一两句说明填了哪些分镜。返回 `cancelled` 就说这次没填入。

不要引导用户去「Codex 工作台」侧栏。

## 禁止

- 禁止系统弹窗、浏览器、本机网页向导。
- 禁止 `find`、`grep`、`rg`、`ls`、`mdfind` 自己找分镜/资产路径。
- 禁止向用户索要「你记得的路径」；只使用表单填写或本轮附件路径。
- 禁止先调用 `jimeng_load` / `jimeng_durations` / `jimeng_assets` 代替向导。
- 用户没明确说「生成 / 开始生成 / 点生成」时，不调用 `jimeng_generate`。
- 返回 `UPLOAD_UNCONFIRMED` 后不要重试；用户说已核对后再 `jimeng_ack`（`确认` 为 `已核对页面`）。
- 返回 `VIDEO_MODE_REQUIRED` 时请用户在即梦改成视频生成，不要自行切换创作类型。
- 不下载成片，不改模型、参考模式和画幅。

工具参数见 [tools.md](references/tools.md)。
