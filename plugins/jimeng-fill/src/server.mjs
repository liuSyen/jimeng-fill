#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { runGuide } from './guide.mjs'
import {
  acknowledgePage,
  assignReference,
  confirmMatches,
  currentAsk,
  fillJimeng,
  fillPrompt,
  generateJimeng,
  inspectJimeng,
  listShots,
  loadAssets,
  loadDurations,
  loadStoryboard,
  openJimeng,
  screenshotJimeng,
  showShot,
  stopJimeng
} from './tools.mjs'

function wrap(fn) {
  return async args => {
    try {
      const data = await fn(args || {})
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...data }, null, 2) }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败'
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ ok: false, code: error?.code || 'OPERATION_FAILED', message }, null, 2) }]
      }
    }
  }
}

export function createServer() {
  const server = new McpServer({ name: 'jimeng', version: '0.1.10' }, { capabilities: { elicitation: {} } })
  server.registerTool('jimeng_guide', {
    description: '官方 Codex 填即梦入口。优先用会话内 MCP 表单（单选+确认）展示已读分镜与选项；选文件用系统文件选择器；不打开浏览器。首次无参调用并等待表单；若退回 chat 模式，把 message 贴进对话后带 reply/path/text 再调。不会点击生成。',
    inputSchema: {
      reply: z.string().optional().describe('用户在对话框里回复的选项原文或编号'),
      path: z.string().optional().describe('用户用 Codex「+」附上的分镜/秒数表/参考图文件夹绝对路径'),
      storyboardPath: z.string().optional().describe('分镜文件路径，等同 path'),
      durationsPath: z.string().optional().describe('秒数表路径'),
      referencesDir: z.string().optional().describe('参考图文件夹路径'),
      text: z.string().optional().describe('用户粘贴的分镜全文'),
      durations: z.record(z.union([z.number(), z.string()])).optional().describe('会话内秒数表 JSON'),
      shotId: z.string().optional().describe('要填入或补充的分镜编号'),
      replace: z.boolean().optional().describe('清空编辑器后重填'),
      regen: z.boolean().optional().describe('对 shotId 让 Codex 补充提示词')
    }
  }, async (args = {}) => {
    try {
      const data = await runGuide(server, args)
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...data }, null, 2) }] }
    } catch (error) {
      const message = error instanceof Error ? error.message : '操作失败'
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: error?.code || 'OPERATION_FAILED', message }, null, 2) }] }
    }
  })
  server.registerTool('jimeng_open', {
    description: '打开或连接独立 Chrome 里的即梦创作页，返回视频编辑器是否就绪。不会点击生成。',
    inputSchema: {}
  }, wrap(openJimeng))
  server.registerTool('jimeng_inspect', {
    description: '查看当前即梦视频编辑器的模型、参考模式、时长、提示词长度和参考图数量。不会修改页面。',
    inputSchema: {}
  }, wrap(inspectJimeng))
  server.registerTool('jimeng_screenshot', {
    description: '截一张当前即梦页面，返回图片路径。编辑器找不到或像是登录页时使用。',
    inputSchema: {}
  }, wrap(screenshotJimeng))
  server.registerTool('jimeng_next', {
    description: '查看当前该问用户的那一句。恢复对话或不确定下一步时先调用。把返回的 ask 原样问用户，然后停下来等回答。不要连着调用下一步。',
    inputSchema: {}
  }, wrap(currentAsk))
  server.registerTool('jimeng_load', {
    description: '仅向导内部或中断恢复时用。不要用它代替 jimeng_guide，也不要用 find/grep 自己找分镜路径。导入 TXT/MD/DOCX；不要同次带秒数表或参考图目录。',
    inputSchema: {
      storyboardPath: z.string().optional().describe('用户刚刚选定的分镜文件绝对路径'),
      text: z.string().optional().describe('用户直接粘贴的分镜全文。与 storyboardPath 二选一')
    }
  }, wrap(loadStoryboard))
  server.registerTool('jimeng_durations', {
    description: '只在用户已经回答秒数表那一问之后调用。传入 durationsPath、会话内 durations 对象，或在用户明确说跳过时传 skip=true。不要和分镜、参考图目录同一轮调用。',
    inputSchema: {
      durationsPath: z.string().optional().describe('用户选定的秒数表。xlsx 需有“分镜”和“推荐时长（秒）”列，或 json 如 {"1-1":5}'),
      durations: z.record(z.union([z.number(), z.string()])).optional().describe('会话内编辑的秒数表，如 {"1-1":20}'),
      skip: z.boolean().optional().describe('仅当用户明确说没有秒数表、跳过时为 true')
    }
  }, wrap(loadDurations))
  server.registerTool('jimeng_assets', {
    description: '只在用户已经选定参考图文件夹之后调用。不要提前扫描，也不要和前两步同一轮调用。然后只问返回的 ask。',
    inputSchema: {
      referencesDir: z.string().describe('用户选定的参考图文件夹绝对路径')
    }
  }, wrap(loadAssets))
  server.registerTool('jimeng_confirm_matches', {
    description: '只在用户回复“确认匹配”之后调用。confirm 必须是“确认匹配”。匹配还没问完时不要调用。',
    inputSchema: { confirm: z.literal('确认匹配') }
  }, wrap(confirmMatches))
  server.registerTool('jimeng_shots', {
    description: '列出当前批次分镜的编号、是否可填、匹配状态和秒数，不含全文。',
    inputSchema: {
      episode: z.number().int().optional().describe('只看这一集'),
      readyOnly: z.boolean().optional().describe('只看人物和场景已匹配的分镜')
    }
  }, wrap(listShots))
  server.registerTool('jimeng_shot', {
    description: '查看一条分镜的完整提示词和参考图匹配。',
    inputSchema: { shotId: z.string().describe('分镜编号，例如 1-1') }
  }, wrap(args => showShot(args.shotId)))
  server.registerTool('jimeng_assign', {
    description: '用户已经从候选里选定一张图，或明确说跳过之后，才记录这一条参考图。ref 用返回里的 ref。用户说编号时，用上一问 choices 里对应的 id，不要自己改选。跳过时 skip=true。然后只问新的 ask。',
    inputSchema: {
      ref: z.string().describe('例如 角色:林晚'),
      asset: z.string().optional().describe('用户选定的文件名或相对路径'),
      skip: z.boolean().optional().describe('仅当用户明确说这张图跳过时为 true')
    }
  }, wrap(assignReference))
  server.registerTool('jimeng_fill', {
    description: '只在当前 step 为 ready、且用户给出分镜编号之后，把这一条的时长、提示词和参考图填进即梦。编辑器已有内容时先问用户，同意后再传 replace=true。不会点击生成。',
    inputSchema: {
      shotId: z.string(),
      replace: z.boolean().optional().describe('确认清空当前编辑器里的文字和参考图后再填'),
      imageLimit: z.number().int().min(1).max(100).optional().describe('页面读不到参考图上限时，由用户给出的张数')
    },
    annotations: { destructiveHint: true }
  }, wrap(fillJimeng))
  server.registerTool('jimeng_prompt_only', {
    description: '只在 step 为 ready 且用户指定分镜后，补这一条的提示词和时长。不上传、不删除参考图。编辑器里已有不同文字时会停止。',
    inputSchema: { shotId: z.string() }
  }, wrap(fillPrompt))
  server.registerTool('jimeng_generate', {
    description: '仅当用户明确要求点击生成，且 confirm 为“确认生成”时，对刚填入且页面内容仍一致的那条分镜点一次生成。不会下载视频。',
    inputSchema: {
      shotId: z.string(),
      confirm: z.literal('确认生成')
    },
    annotations: { destructiveHint: true }
  }, wrap(generateJimeng))
  server.registerTool('jimeng_stop', {
    description: '停止正在进行的填入。已经写进页面的内容保留，不会自动重试。',
    inputSchema: {}
  }, wrap(stopJimeng))
  server.registerTool('jimeng_ack', {
    description: '用户已经亲自看过即梦页面并确认可以继续后，清除“上传未确认”标记。confirm 必须是“已核对页面”。',
    inputSchema: { confirm: z.literal('已核对页面') }
  }, wrap(acknowledgePage))
  return server
}

const entry = process.argv[1] || ''
if (entry.endsWith('server.mjs')) {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
