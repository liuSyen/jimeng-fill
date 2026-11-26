# 即梦填图词

把分镜提示词、参考图和推荐秒数填进 [即梦](https://jimeng.jianying.com) 视频编辑器的 Codex skill 和 MCP。

它按这个顺序一次只问一个问题：分镜文档、秒数表、参考图文件夹、逐条确认参考图、要填的分镜编号。用户明确说生成之前，不会点击生成。

## 环境

- macOS，并已安装 Google Chrome
- Node.js 20 或更高
- Codex
- 即梦账号。第一次会弹出一个独立 Chrome 窗口，在那个窗口里登录

这个独立窗口使用 `~/.codex/jimeng-chrome`，调试端口是 `127.0.0.1:9333`，不会占用平时使用的 Chrome。

## 安装

两条命令会同时装上 skill 和 MCP。不需要先克隆仓库，也不需要手动执行 `npm install`。第一次启动 MCP 时会自己装依赖。

```bash
codex plugin marketplace add liuSyen/jimeng-fill
codex plugin add jimeng-fill@jimeng-fill
```

装好后新开一轮 Codex 对话。

## 使用

先在即梦里把创作类型切换成视频生成。然后让智能体开始填图词，它会依次问你：

1. 选择分镜文档（TXT、MD、DOCX，或直接贴全文）
2. 选择秒数表；没有就回复「跳过」
3. 选择参考图文件夹
4. 缺图或有多张同名图时，一次确认一条
5. 回复「确认匹配」
6. 告诉它要填的分镜编号，例如 `1-1`

工具说明在 [plugins/jimeng-fill/skills/jimeng-fill/references/tools.md](plugins/jimeng-fill/skills/jimeng-fill/references/tools.md)。

## 许可

[MIT](LICENSE)
