import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'
import { coded } from './errors.mjs'
import { installJimengPageApi } from './page-api.mjs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const GENERATE_URL = 'https://jimeng.jianying.com/ai-tool/generate'
const METHODS = new Set(['inspect', 'begin', 'stop', 'inventory', 'setDuration', 'writePrompt', 'clearComposer', 'assignFiles', 'clickGenerate'])

let browserPromise = null

export function cdpBase() {
  return (process.env.JIMENG_CDP_HTTP || `http://127.0.0.1:${process.env.JIMENG_CDP_PORT || 9333}`).replace(/\/$/, '')
}

export function chromeProfile() {
  return process.env.JIMENG_CHROME_PROFILE || join(homedir(), '.codex', 'jimeng-chrome')
}

async function debuggerReady() {
  try {
    const response = await fetch(`${cdpBase()}/json/version`, { signal: AbortSignal.timeout(800) })
    if (!response.ok) return false
    const body = await response.json()
    return typeof body.webSocketDebuggerUrl === 'string'
  } catch {
    return false
  }
}

async function launchChrome() {
  if (process.env.JIMENG_CDP_HTTP) {
    throw coded('指定的调试地址没有 Chrome。请先打开那个浏览器，或取消 JIMENG_CDP_HTTP。', 'BROWSER_NOT_RUNNING')
  }
  const profile = chromeProfile()
  await mkdir(profile, { recursive: true })
  const port = new URL(cdpBase()).port || '9333'
  const child = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    GENERATE_URL
  ], { detached: true, stdio: 'ignore' })
  child.unref()
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await debuggerReady()) return
    await delay(250)
  }
  throw coded('Chrome 已启动，但调试端口没有就绪。', 'BROWSER_TIMEOUT')
}

export async function connectBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      if (!(await debuggerReady())) await launchChrome()
      const browser = await chromium.connectOverCDP(cdpBase())
      browser.on('disconnected', () => { browserPromise = null })
      return browser
    })().catch(error => {
      browserPromise = null
      throw error
    })
  }
  return browserPromise
}

function jimengPages(context) {
  return context.pages().filter(page => {
    try { return new URL(page.url()).hostname === 'jimeng.jianying.com' } catch { return false }
  })
}

export async function jimengPage({ open = false } = {}) {
  const browser = await connectBrowser()
  const context = browser.contexts()[0]
  if (!context) throw coded('没有可用的浏览器窗口。', 'BROWSER_NOT_RUNNING')
  let pages = jimengPages(context)
  if (!pages.length && open) {
    const deadline = Date.now() + 8000
    while (!pages.length && Date.now() < deadline) {
      await delay(250)
      pages = jimengPages(context)
    }
  }
  if (pages.length > 1) throw coded('有多个即梦标签，请只留一个创作页后再连接。', 'JIMENG_TAB_AMBIGUOUS')
  let page = pages[0]
  if (!page) {
    if (!open) throw coded('没有打开的即梦页。', 'JIMENG_TAB_REQUIRED')
    page = await context.newPage()
    await page.goto(GENERATE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  }
  if (new URL(page.url()).hostname !== 'jimeng.jianying.com') throw coded('当前标签不是即梦官网。', 'WRONG_TAB')
  page.setDefaultTimeout(50000)
  await page.waitForSelector('[data-testid="dreamina.generator"]', { timeout: 12000 }).catch(() => {})
  const installed = await page.evaluate(installJimengPageApi)
  if (!installed?.ok) throw coded(installed?.message || '即梦页面脚本没有挂上。', installed?.code || 'CONTENT_UNAVAILABLE')
  return page
}

export async function pageCall(page, method, arg) {
  if (!METHODS.has(method)) throw coded('页面操作不在允许范围内。', 'PAGE_METHOD')
  try {
    return await page.evaluate(async ({ method: name, arg: payload }) => {
      const pageApi = globalThis.__jimengCodex
      if (!pageApi || typeof pageApi[name] !== 'function') {
        return { ok: false, code: 'PAGE_API_MISSING', message: '即梦页面脚本未挂上，请重新打开页面。' }
      }
      try {
        return await pageApi[name](payload)
      } catch (error) {
        return { ok: false, code: error?.code || 'FILL_FAILED', message: error?.message || '页面操作失败' }
      }
    }, { method, arg })
  } catch (error) {
    throw coded(error instanceof Error ? error.message : '即梦页面没有回应。', 'CONTENT_UNAVAILABLE')
  }
}
