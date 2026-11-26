# jimeng 工具

服务名：`jimeng`。插件安装后由 Codex 启动；本机调试命令是 `node plugins/jimeng-fill/src/server.mjs`。

官方 Codex 会话里，用户要填即梦时调用 `jimeng_guide`。把返回的 `message`/`preview`/`options` 显示在对话框里，等用户回复后再带 `reply` 或附件 `path` 继续。禁止系统弹窗、禁止浏览器网页向导，禁止 find/grep/ls 搜盘，不要提企业工作台侧栏。下面其余工具留给向导内部和中断后的恢复。

| 工具 | 作用 | 参数 |
|---|---|---|
| `jimeng_guide` | 会话对话框步进：展示读入内容与选项，再用 reply/path/text 推进 | 可选 `reply`、`path`、`text`、`durations`、`shotId`、`replace`、`regen` |
| `jimeng_next` | 看当前该问的那一句 | 无 |
| `jimeng_load` | 只导入分镜，替换当前批次 | `storyboardPath` 或 `text` |
| `jimeng_durations` | 导入秒数表、会话内秒数对象，或跳过 | `durationsPath`，或 `durations` 如 `{"1-1":20}`，或 `skip: true` |
| `jimeng_assets` | 扫描用户选定的参考图文件夹并自动配同名图 | `referencesDir` |
| `jimeng_assign` | 记下用户刚选的一张图，或跳过这一条 | `ref` 如 `角色:林晚`；`asset` 为 `choices` 里的 id；跳过用 `skip: true` |
| `jimeng_confirm_matches` | 用户确认整份搭配 | `confirm` 必须是 `确认匹配` |
| `jimeng_shots` | 列出分镜，仍要遵守返回的 `ask` | 可选 `episode`、`readyOnly` |
| `jimeng_shot` | 一条的全文 | `shotId`，如 `1-1` |
| `jimeng_open` | 打开独立 Chrome 里的即梦创作页 | 无 |
| `jimeng_inspect` | 读模型、模式、时长、提示词长度、参考图数量 | 无 |
| `jimeng_screenshot` | 截图，返回 `path` | 无 |
| `jimeng_fill` | `step` 为 `ready` 后填时长、提示词、参考图 | `shotId`；可选 `replace`、`imageLimit` |
| `jimeng_prompt_only` | 只补提示词和时长 | `shotId` |
| `jimeng_generate` | 点一次生成 | `shotId`，`confirm` 必须是 `确认生成` |
| `jimeng_stop` | 停止填入 | 无 |
| `jimeng_ack` | 清除上传未确认 | `confirm` 必须是 `已核对页面` |

分镜标题形如 `分镜 1-1`。资产头用 `【角色】` `【场景】` `【道具】`。写「无」的资产不配图。同名文件只有一张时按文件名配上，多张或没有时必须问用户。道具不是必填。

`step` 顺序：`storyboard` → `durations` → `assets` → `matching` → `confirm_matches` → `ready`。
