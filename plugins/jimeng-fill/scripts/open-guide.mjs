#!/usr/bin/env node
/** 本机调试：打印会话内向导当前步骤（不弹窗） */
import { runGuide } from '../src/guide.mjs'

const reply = process.argv[2]
const path = process.argv[3]
const result = await runGuide(null, {
  ...(reply ? { reply } : {}),
  ...(path ? { path } : {})
})
process.stdout.write(`${JSON.stringify({ ok: true, ...result }, null, 2)}\n`)
if (result?.cancelled) process.exitCode = 1
