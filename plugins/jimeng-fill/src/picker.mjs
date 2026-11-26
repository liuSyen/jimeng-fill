import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { coded } from './errors.mjs'

const execFileAsync = promisify(execFile)

function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function listLiteral(items) {
  return `{${items.map(item => quote(item)).join(', ')}}`
}

function cancelled(error) {
  const text = String(error?.stderr || error?.message || error || '')
  return /User canceled|user cancelled|-128/i.test(text)
}

async function runAppleScript(source) {
  try {
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', source], {
      maxBuffer: 2 * 1024 * 1024,
      timeout: 10 * 60 * 1000
    })
    return String(stdout || '').trim()
  } catch (error) {
    if (cancelled(error)) return null
    throw coded(`本机选择器失败：${error?.stderr || error?.message || error}`, 'PICKER_FAILED')
  }
}

/** 系统文件选择器；取消返回 null。不开浏览器。 */
export async function chooseFile(prompt, { types = [] } = {}) {
  const typeClause = types.length ? ` of type ${listLiteral(types)}` : ''
  const out = await runAppleScript(`POSIX path of (choose file with prompt ${quote(prompt)}${typeClause})`)
  return out || null
}

/** 系统文件夹选择器；取消返回 null。 */
export async function chooseFolder(prompt) {
  const out = await runAppleScript(`POSIX path of (choose folder with prompt ${quote(prompt)})`)
  return out || null
}

/** 系统列表选择；取消返回 null。 */
export async function chooseFromList(prompt, items) {
  if (!items?.length) return null
  const out = await runAppleScript(
    `choose from list ${listLiteral(items)} with prompt ${quote(prompt)} OK button name "下一步" cancel button name "取消"`
  )
  if (!out || out === 'false') return null
  return out
}

/** 确认对话框；确认 true，取消 false。 */
export async function confirmDialog(prompt, { ok = '下一步', cancel = '取消' } = {}) {
  const out = await runAppleScript(
    `button returned of (display dialog ${quote(prompt)} buttons {${quote(cancel)}, ${quote(ok)}} default button ${quote(ok)} cancel button ${quote(cancel)})`
  )
  return Boolean(out)
}

/** 文本输入框；取消返回 null。 */
export async function textDialog(prompt, defaultAnswer = '') {
  const out = await runAppleScript(
    `text returned of (display dialog ${quote(prompt)} default answer ${quote(defaultAnswer)} buttons {"取消", "下一步"} default button "下一步" cancel button "取消")`
  )
  return out == null ? null : out
}
