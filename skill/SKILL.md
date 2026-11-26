---
name: jimeng-fill
description: 把分镜提示词、参考图和推荐秒数填进即梦（jimeng.jianying.com）当前视频编辑器。用于“填即梦”“图词助手”“把这条分镜填进去”“补提示词”“按秒数表设置时长”。选分镜文档、秒数表、参考图目录、手动配图都要一次只问一个问题，等用户回答后再继续。用户明确说生成之前，不点击生成。
---

# 即梦填图词

用 MCP 服务 `jimeng` 操作即梦视频编辑器。它承接浏览器插件「即梦分镜图词助手」v0.1.13：解析分镜、匹配参考图、设置时长、写入提示词、上传参考图。默认不点击生成。

浏览器是独立配置，目录 `~/.codex/jimeng-chrome`，调试端口 `127.0.0.1:9333`。不占用用户平时的 Chrome，也不走那个插件的侧栏。第一次会弹出窗口，需要在这个窗口登录即梦。

## 一次只问一句

每一轮只做三件事：看工具返回的 `ask`，把这一句原样问用户，然后停下来等回答。不要把下一步的问题一起问出来，也不要在同一轮里连着调用下一步。恢复对话时先 `jimeng_next`。

返回 `NEED_ANSWER` 或 `STEP_BY_STEP` 时，把 `message` 原样问用户，然后停下。不要猜路径，也不要自己挑参考图。

1. 问用户选哪一份分镜文档。得到路径或全文后，只调用 `jimeng_load`。
2. 问秒数表。用户给了文件就 `jimeng_durations`；用户明确说没有或跳过，才传 `skip: true`。
3. 问参考图文件夹。用户选定后才 `jimeng_assets`。
4. `step` 是 `matching` 时，只问这一条。用户回复编号时，用返回的 `choices` 换成对应 `id`，再 `jimeng_assign`。用户说跳过才传 `skip: true`。问完下一条再停。
5. `step` 是 `confirm_matches` 时，把配好的名单问用户。用户要改某一条，就按他说的再 `jimeng_assign`。用户回复确认匹配后，才调用 `jimeng_confirm_matches`，`confirm` 为 `确认匹配`。
6. `step` 是 `ready` 后，问要填哪一条。用户给出编号再 `jimeng_fill`。

`jimeng_open` 或 `jimeng_inspect` 放在用户准备填入的时候。`editorFound` 不是 true 时，先看返回码。`VIDEO_MODE_REQUIRED` 表示当前是 Agent 模式或其他创作类型，请用户在即梦里把创作类型改成视频生成，不要自行切换。其他情况先 `jimeng_screenshot`。不要在没确认视频编辑器时填入。

编辑器里已有文字或参考图时，`jimeng_fill` 会停下。先告诉用户会清空，得到同意后再传 `replace: true`。

填完后念出返回的时长、图片名单和被省略的道具，请用户看页面。不要自动填下一条。

只补提示词、保留现有图片时，也要等 `step` 为 `ready` 并且用户指定分镜，再用 `jimeng_prompt_only`。页面上已有不同文字就停止，不要改成覆盖。

## 不要做的事

- 用户没明确说「生成 / 开始生成 / 点生成」时，不调用 `jimeng_generate`。调用时 `confirm` 固定为 `确认生成`，而且只能对刚刚填好、页面内容仍一致的那条使用。
- 返回 `UPLOAD_UNCONFIRMED` 后不要重试上传。请用户看页面，用户说已经核对后才调用 `jimeng_ack`（`confirm` 为 `已核对页面`）。
- 返回 `REFERENCE_LIMIT_UNKNOWN` 时，问用户当前模型能传几张，把数字放进 `imageLimit`。不要猜张数，也不要改用近似秒数。
- 道具可以因为张数上限被省略；人物或场景超限时停止并说明。
- 不下载成片，不改即梦模型、参考模式和画幅。那些保持用户在页面上的选择。

工具参数见 [tools.md](references/tools.md)。
