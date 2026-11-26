import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { hashFile, mimeType } from './assets.mjs'
import { jimengPage, pageCall } from './browser.mjs'
import { durationFor } from './durations.mjs'
import { coded } from './errors.mjs'
import { promptsEqual, referencePlan, resolveImageLimit, verifyText } from './plan.mjs'
import { saveState, stateFile } from './state.mjs'

const session = { filling: false, stopRequested: false }

export function requestStop() {
  session.stopRequested = true
}

function ensureRunning() {
  if (session.stopRequested) throw coded('已停止填入，现有内容保留。', 'PAUSED')
}

function taskById(state, shotId) {
  const task = state.tasks.find(item => item.id === shotId)
  if (!task) throw coded('分镜不存在，请重新加载文档。', 'TASK_MISSING')
  if (!String(task.prompt || '').trim()) throw coded('本条提示词为空。', 'EMPTY_PROMPT')
  return task
}

async function filesFor(state, plan) {
  const files = []
  let total = 0
  for (const id of plan.assetIds) {
    const asset = state.assets.find(item => String(item.id) === String(id))
    if (!asset) throw coded('参考图不在本次匹配里，请重新加载参考图目录。', 'ASSET_MISSING')
    const file = await hashFile(asset.path)
    if (file.sha256 !== asset.sha256) throw coded(`参考图自匹配后已改变，未上传：${asset.name}`, 'ASSET_CHANGED')
    if (file.size < 1 || file.size > 30 * 1024 * 1024) throw coded(`单张图片大小无效：${asset.name}`, 'ASSET_TOO_LARGE')
    total += file.size
    if (total > 40 * 1024 * 1024) throw coded('本批图片超过 40MB，请先缩小图片。', 'UPLOAD_PAYLOAD_TOO_LARGE')
    files.push({ name: asset.name, type: mimeType(asset.name), size: file.size, sha256: file.sha256, base64: file.bytes.toString('base64') })
  }
  if (new Set(files.map(file => file.name.toLowerCase())).size !== files.length) {
    throw coded('本条参考图存在重复文件名，无法唯一核对。', 'DUPLICATE_REFERENCE_NAME')
  }
  return files
}

async function must(page, method, arg) {
  ensureRunning()
  const result = await pageCall(page, method, arg)
  if (!result?.ok) throw coded(result?.message || '即梦页面没有返回有效结果。', result?.code || 'CONTENT_UNAVAILABLE')
  return result
}

function project(view) {
  if (!view?.editorFound) {
    return { editorFound: false, url: view?.url || null, code: view?.code || 'EDITOR_NOT_FOUND', message: view?.message || '没有找到即梦视频编辑器。' }
  }
  return {
    editorFound: true,
    url: view.url,
    model: view.model,
    mode: view.mode,
    duration: view.duration,
    promptLength: view.promptLength,
    promptPreview: String(view.prompt || '').slice(0, 80),
    attachmentCount: view.attachmentCount,
    referencesCollapsed: view.referencesCollapsed,
    referencesEmpty: view.referencesEmpty,
    siteImageLimit: view.siteImageLimit,
    totalLimit: view.totalLimit
  }
}

export async function openEditor() {
  const page = await jimengPage({ open: true })
  await page.bringToFront().catch(() => {})
  return project(await pageCall(page, 'inspect'))
}

export async function capturePage() {
  const page = await jimengPage({ open: true })
  const path = join(dirname(stateFile()), 'last-page.png')
  await page.screenshot({ path, fullPage: false })
  return { path, ...project(await pageCall(page, 'inspect')) }
}

async function waitForImages(page, expected, prompt) {
  let lastKey = ''
  let stableSince = 0
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    ensureRunning()
    const view = await pageCall(page, 'inventory', prompt)
    if (!view?.ok) throw coded(view?.message || '上传期间页面发生变化。', view?.code || 'UPLOAD_UNCONFIRMED')
    if (view.uploadError) throw coded(view.uploadError, 'UPLOAD_ERROR')
    if (view.attachmentCount > expected) throw coded('参考区出现额外图片，未继续覆盖。', 'UNKNOWN_REFERENCES')
    const key = JSON.stringify([view.attachmentCount, view.loaded, view.busy, view.complete, view.promptMatches])
    if (key !== lastKey) {
      lastKey = key
      stableSince = Date.now()
    }
    const ready = view.complete && !view.referencesCollapsed && view.attachmentCount === expected && view.loaded && !view.busy && view.promptMatches
    if (ready && Date.now() - stableSince >= 500) return view
    await delay(150)
  }
  throw coded('参考图片未全部得到页面确认。请先看页面，不要立刻重试。', 'UPLOAD_UNCONFIRMED')
}

export async function fillShot(state, { shotId, replace = false, imageLimit = null, promptOnly = false } = {}) {
  if (session.filling) throw coded('当前条目尚在填写，请等待或先停止。', 'FILL_RUNNING')
  if (state.uncertainUpload) throw coded('上一次上传没有得到页面确认。请先看即梦页面，核对后告诉我“已核对页面”。', 'UPLOAD_UNCONFIRMED')
  const task = taskById(state, shotId)
  if (!promptOnly && task.ready === false) throw coded('本条人物或场景尚未匹配完整。', 'ASSETS_MISSING')
  const seconds = durationFor(state.durations, task.id)
  session.filling = true
  session.stopRequested = false
  let sentUpload = false
  try {
    const page = await jimengPage({ open: true })
    await page.bringToFront().catch(() => {})
    const opened = await must(page, 'begin')
    if (!opened.editorFound) throw coded(opened.message || '请先在即梦打开视频生成。', opened.code || 'EDITOR_NOT_FOUND')
    const empty = !opened.promptLength && opened.referencesEmpty
    if (!promptOnly && !empty && !replace) throw coded('编辑器已有内容。确认要替换当前图词后，再清空并填入。', 'EDITOR_NOT_EMPTY')
    if (promptOnly && opened.prompt && !promptsEqual(opened.prompt, task.prompt)) throw coded('当前已有其他文字，只补词不会覆盖。', 'EDITOR_NOT_EMPTY')
    const limit = resolveImageLimit({
      model: opened.model,
      mode: opened.mode,
      siteImageLimit: opened.siteImageLimit,
      totalLimit: opened.totalLimit,
      override: imageLimit
    })
    const plan = promptOnly ? null : referencePlan(task, limit)
    if (seconds != null) await must(page, 'setDuration', seconds)
    if (!promptOnly && replace && !empty) await must(page, 'clearComposer')
    const current = await must(page, 'inspect')
    if (!promptsEqual(current.prompt, task.prompt)) await must(page, 'writePrompt', verifyText(task.prompt))
    if (!promptOnly && plan.selectedCount) {
      const files = await filesFor(state, plan)
      sentUpload = true
      const assigned = await pageCall(page, 'assignFiles', files)
      if (!assigned?.dispatched) sentUpload = false
      if (!assigned?.ok) throw coded(assigned?.message || '参考图没有传上页面。', assigned?.code || 'UPLOAD_BRIDGE_FAILED')
      await waitForImages(page, plan.selectedCount, task.prompt)
    } else if (!promptOnly) {
      const view = await must(page, 'inventory', task.prompt)
      if (!view.referencesEmpty) throw coded('这条分镜没有参考图，但页面上仍有素材。', 'REFERENCES_NOT_EMPTY')
    }
    const done = await must(page, 'inspect')
    if (!promptsEqual(done.prompt, task.prompt)) throw coded('填入后的提示词与分镜不一致。', 'EDITOR_CHANGED')
    if (seconds != null && done.duration !== seconds) throw coded(`当前时长为 ${done.duration} 秒，未确认目标 ${seconds} 秒。`, 'DURATION_CHANGED')
    state.uncertainUpload = false
    state.lastFill = {
      shotId: task.id,
      mode: promptOnly ? 'prompt_only' : 'full',
      prompt: task.prompt,
      imageCount: promptOnly ? null : plan.selectedCount,
      duration: seconds,
      at: new Date().toISOString()
    }
    await saveState(state)
    await pageCall(page, 'stop').catch(() => {})
    return {
      shotId: task.id,
      mode: state.lastFill.mode,
      duration: seconds,
      promptLength: done.promptLength,
      attachmentCount: done.attachmentCount,
      images: plan?.selectedNames || [],
      omittedOptionalNames: plan?.omittedOptionalNames || [],
      limitSource: limit.source,
      page: project(done),
      generate: false,
      message: promptOnly ? '提示词已补上，图片没有重传。生成仍需你明确要求。' : '图词已填好。请核对页面；生成仍需你明确要求。'
    }
  } catch (error) {
    if (sentUpload) {
      state.uncertainUpload = true
      await saveState(state).catch(() => {})
    }
    throw error
  } finally {
    session.filling = false
  }
}

export async function clickGenerate(state, shotId) {
  if (session.filling) throw coded('填写尚未结束，不能点生成。', 'FILL_RUNNING')
  const last = state.lastFill
  if (!last || last.shotId !== shotId) throw coded('页面上一次填入的不是这条分镜，未点击生成。', 'GENERATE_UNVERIFIED')
  const page = await jimengPage({ open: false })
  const view = await pageCall(page, 'inspect')
  if (!view?.ok || !view.editorFound) throw coded(view?.message || '没有找到视频编辑器，未点击生成。', view?.code || 'EDITOR_NOT_FOUND')
  if (!promptsEqual(view.prompt, last.prompt)) throw coded('页面提示词与刚填入的分镜不一致，未点击生成。', 'GENERATE_UNVERIFIED')
  if (last.mode === 'full' && view.attachmentCount !== last.imageCount) throw coded('页面参考图数量与刚填入的不一致，未点击生成。', 'GENERATE_UNVERIFIED')
  if (last.duration != null && view.duration !== last.duration) throw coded('页面时长与分镜秒数不一致，未点击生成。', 'GENERATE_UNVERIFIED')
  const clicked = await pageCall(page, 'clickGenerate')
  if (!clicked?.ok) throw coded(clicked?.message || '没有点到生成按钮。', clicked?.code || 'GENERATE_FAILED')
  return { shotId, clicked: clicked.clicked === true, message: '已向生成按钮发出一次点击。请看着即梦页面确认是否开始生成；这里不会下载成片。' }
}
