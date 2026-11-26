# 即梦填图词

把分镜提示词、参考图和推荐秒数填进 [即梦](https://jimeng.jianying.com) 视频编辑器的 Codex skill 和 MCP。

在当前 Codex 对话框里展示已读分镜内容与选项，直接回复编号或用「+」附上文件继续；不弹系统窗，不打开浏览器。逐条手改或让 Codex 补充后填进即梦。用户明确说生成之前，不会点击生成。

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

先在即梦里把创作类型切换成视频生成。在**官方 Codex** 里说「填即梦」，它会调用 `jimeng_guide`（只在对话框里操作，不弹窗、不打开浏览器）：

1. 用「+」附上分镜文档；读入后对话框里会列出各条内容
2. 直接回复选项：用标题秒数 / 改秒数 / 附秒数表 / 跳过
3. 再附上参考图文件夹，按提示匹配
4. 逐条手改或让 Codex 补充，再填入即梦

不要搜盘，也不要在企业「Codex 工作台」里找侧栏菜单。

工具说明在 [plugins/jimeng-fill/skills/jimeng-fill/references/tools.md](plugins/jimeng-fill/skills/jimeng-fill/references/tools.md)。

## 许可

[MIT](LICENSE)
