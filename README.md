# 即梦填图词

把分镜提示词、参考图和推荐秒数填进 [即梦](https://jimeng.jianying.com) 视频编辑器的 Codex skill 和 MCP。

它按这个顺序一次只问一个问题：分镜文档、秒数表、参考图文件夹、逐条确认参考图、要填的分镜编号。用户明确说生成之前，不会点击生成。

## 环境

- macOS，并已安装 Google Chrome
- Node.js 20 或更高
- Codex，或其他支持 stdio MCP 的智能体
- 即梦账号。第一次会弹出一个独立 Chrome 窗口，在那个窗口里登录

这个独立窗口使用 `~/.codex/jimeng-chrome`，调试端口是 `127.0.0.1:9333`，不会占用平时使用的 Chrome。

## 下载

```bash
git clone https://github.com/liuSyen/jimeng-fill.git
cd jimeng-fill
npm install
npm test
```

## 安装 skill

```bash
mkdir -p ~/.codex/skills
ln -s "$(pwd)/skill" ~/.codex/skills/jimeng-fill
```

## 注册 MCP

在 `~/.codex/config.toml` 末尾加入下面这一段，把路径换成你克隆下来的目录：

```toml
[mcp_servers.jimeng]
command = "node"
args = ["/绝对路径/jimeng-fill/src/server.mjs"]
startup_timeout_sec = 45
```

保存后新开一轮 Codex 对话，skill 和 MCP 才会被加载。其他智能体把同一条命令配成 stdio MCP，服务名用 `jimeng`。

## 使用

先在即梦里把创作类型切换成视频生成。然后让智能体开始填图词，它会依次问你：

1. 选择分镜文档（TXT、MD、DOCX，或直接贴全文）
2. 选择秒数表；没有就回复「跳过」
3. 选择参考图文件夹
4. 缺图或有多张同名图时，一次确认一条
5. 回复「确认匹配」
6. 告诉它要填的分镜编号，例如 `1-1`

工具说明在 [skill/references/tools.md](skill/references/tools.md)。

## 许可

[MIT](LICENSE)
