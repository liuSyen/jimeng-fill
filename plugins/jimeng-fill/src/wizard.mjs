import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { coded } from './errors.mjs'
import { assignReference, confirmMatches, fillJimeng, loadAssets, loadDurations, loadStoryboard, updateShotPrompt, wizardBoard } from './tools.mjs'

const STORY_EXT = new Set(['.txt', '.md', '.docx'])
const DURATION_EXT = new Set(['.xlsx', '.json'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.tif', '.tiff', '.heic'])

function headerText(value) {
  const raw = Array.isArray(value) ? value[0] : value
  const text = String(raw || '')
  try { return decodeURIComponent(text) } catch { return text }
}

function safeName(value) {
  const parts = headerText(value).split(/[\\/]/).filter(part => part && part !== '.' && part !== '..' && !part.startsWith('.'))
  return parts.join('/') || 'file'
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(coded('文件太大。', 'DOCUMENT_TOO_LARGE'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function fail(res, error) {
  const message = error instanceof Error ? error.message : '操作失败'
  send(res, 400, { ok: false, code: error?.code || 'OPERATION_FAILED', message })
}

export function wizardPage() {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>即梦填图词</title>
<style>
  body { margin: 0; background: #111; color: #f3f3f3; font: 15px/1.5 ui-sans-serif, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 28px 20px 96px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: #c8c8c8; }
  ol { display: flex; gap: 8px; padding: 0; margin: 0 0 24px; list-style: none; flex-wrap: wrap; }
  li { padding: 4px 10px; border-radius: 999px; background: #222; color: #9a9a9a; }
  li.on { background: #f3f3f3; color: #111; }
  label.pick { display: inline-block; background: #f3f3f3; color: #111; border-radius: 8px; padding: 10px 14px; cursor: pointer; }
  input[type=file] { display: none; }
  textarea, select, input[type=number] { width: 100%; box-sizing: border-box; background: #1b1b1b; color: #f3f3f3; border: 1px solid #333; border-radius: 8px; padding: 8px; }
  article { border: 1px solid #2a2a2a; border-radius: 12px; padding: 14px; margin: 0 0 12px; }
  .row { display: grid; grid-template-columns: 140px 1fr; gap: 8px; align-items: center; margin-top: 8px; }
  footer { position: sticky; bottom: 0; background: #111; padding: 16px 0; }
  button { background: #f3f3f3; color: #111; border: 0; border-radius: 8px; padding: 10px 16px; font: inherit; cursor: pointer; }
  button.ghost { background: transparent; color: #f3f3f3; border: 1px solid #444; margin-left: 8px; }
  button:disabled { opacity: .35; cursor: default; }
  #note { min-height: 1.5em; color: #f0c674; }
</style>
</head>
<body>
<main>
  <h1>即梦填图词</h1>
  <p>在这次对话里选文件。选中之后点下一步，逐条改完再填进即梦。</p>
  <ol id="steps"></ol>
  <div id="panel"></div>
  <p id="note"></p>
  <footer><button id="next" disabled>下一步</button></footer>
</main>
<script>
const steps = ['分镜', '秒数', '参考图', '逐条修改', '填入即梦']
const titles = ['选择分镜文档', '选择秒数表', '选择参考图文件夹', '逐条修改', '填入即梦']
let board = null
let stage = 0
let picked = false
const panel = document.querySelector('#panel')
const note = document.querySelector('#note')
const next = document.querySelector('#next')
const stepList = document.querySelector('#steps')

function text(value) { return document.createTextNode(value == null ? '' : String(value)) }
function el(tag, props, children) {
  const node = document.createElement(tag)
  Object.assign(node, props || {})
  for (const child of children || []) node.append(child)
  return node
}
function say(message) { note.textContent = message || '' }
function paintSteps() {
  stepList.replaceChildren()
  steps.forEach((label, index) => {
    const item = el('li', { textContent: label })
    if (index === stage) item.className = 'on'
    stepList.append(item)
  })
}
async function refresh() {
  const response = await fetch('/api/board')
  board = await response.json()
}
function fileButton(label, accept, directory) {
  const input = el('input')
  input.type = 'file'
  if (accept) input.accept = accept
  if (directory) input.multiple = input.webkitdirectory = true
  return { button: el('label', { className: 'pick' }, [text(label), input]), input }
}
async function upload(path, file, headers) {
  const encoded = { 'x-filename': encodeURIComponent(file.name) }
  for (const [key, value] of Object.entries(headers || {})) encoded[key] = encodeURIComponent(value)
  const response = await fetch(path, { method: 'POST', headers: encoded, body: file })
  const body = await response.json()
  if (!response.ok) throw new Error(body.message || '上传失败')
  return body
}

function render() {
  paintSteps()
  panel.replaceChildren()
  next.textContent = stage === 4 ? '填入即梦' : '下一步'
  next.disabled = !picked
  panel.append(el('h2', { textContent: titles[stage] }))
  if (stage === 0) {
    const picker = fileButton('选择分镜文档', '.txt,.md,.docx')
    picker.input.onchange = async () => {
      const file = picker.input.files[0]
      if (!file) return
      try {
        await upload('/api/storyboard', file)
        picked = true
        say('已选中 ' + file.name)
        render()
      } catch (error) { say(error.message) }
    }
    panel.append(picker.button, el('p', { textContent: board && board.sourceName ? '当前文档：' + board.sourceName : '支持 TXT、MD、DOCX。' }))
  }
  if (stage === 1) {
    picked = true
    next.disabled = false
    const picker = fileButton('选择秒数表', '.xlsx,.json')
    picker.input.onchange = async () => {
      const file = picker.input.files[0]
      if (!file) return
      try {
        await upload('/api/durations', file)
        await refresh()
        picked = true
        say('已选中 ' + file.name)
        render()
      } catch (error) { say(error.message) }
    }
    const skip = el('button', { className: 'ghost', type: 'button', textContent: '跳过秒数' })
    skip.onclick = async () => {
      const response = await fetch('/api/durations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skip: true }) })
      const body = await response.json()
      if (!response.ok) return say(body.message)
      await refresh()
      picked = true
      say('已跳过秒数')
      render()
    }
    panel.append(picker.button, skip, el('p', { textContent: '没有秒数表时，可改下面从分镜标题抽出的秒数，然后点下一步。' }))
    for (const shot of board.shots || []) {
      const input = el('input')
      input.type = 'number'
      input.min = '1'
      input.max = '600'
      input.dataset.shot = shot.id
      if (shot.duration != null) input.value = String(shot.duration)
      panel.append(el('div', { className: 'row' }, [text('分镜 ' + shot.id), input]))
    }
  }
  if (stage === 2) {
    const picker = fileButton('选择参考图文件夹', 'image/*', true)
    picker.input.onchange = async () => {
      const files = [...picker.input.files].filter(file => /\\.(png|jpe?g|webp|gif|bmp|avif|tiff?|heic)$/i.test(file.name))
      if (!files.length) return say('这个文件夹里没有图片。')
      try {
        for (const file of files) await upload('/api/asset', file, { 'x-path': file.webkitRelativePath || file.name })
        const response = await fetch('/api/assets/done', { method: 'POST' })
        const body = await response.json()
        if (!response.ok) return say(body.message)
        picked = true
        say('已选中 ' + files.length + ' 张参考图')
        await refresh()
        render()
      } catch (error) { say(error.message) }
    }
    panel.append(picker.button)
  }
  if (stage === 3) {
    picked = true
    next.disabled = false
    for (const shot of board.shots || []) {
      const card = el('article')
      card.append(el('strong', { textContent: shot.id + (shot.duration ? ' · ' + shot.duration + ' 秒' : '') }))
      const area = el('textarea', { value: shot.prompt || '', rows: 6 })
      area.onchange = async () => {
        const response = await fetch('/api/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shotId: shot.id, prompt: area.value }) })
        const body = await response.json()
        if (!response.ok) return say(body.message)
        board = body
        say('已保存 ' + shot.id)
      }
      const regen = el('button', { className: 'ghost', type: 'button', textContent: '让 Codex 重新生成补充' })
      regen.onclick = async () => {
        regen.disabled = true
        say('正在让 Codex 补充 ' + shot.id)
        const response = await fetch('/api/regenerate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shotId: shot.id }) })
        const body = await response.json()
        regen.disabled = false
        if (!response.ok) return say(body.message)
        board = body
        render()
        say('已补充分镜 ' + shot.id)
      }
      card.append(area, regen)
      for (const ref of shot.refs || []) {
        const select = el('select')
        select.append(el('option', { value: '', textContent: '请选择' }))
        for (const asset of board.assets || []) select.append(el('option', { value: asset.id, textContent: asset.name === asset.id ? asset.id : asset.name + ' · ' + asset.id }))
        select.append(el('option', { value: '__skip__', textContent: '跳过这张' }))
        if (ref.assetId) select.value = ref.assetId
        if (ref.status === 'ignored') select.value = '__skip__'
        select.onchange = async () => {
          const skip = select.value === '__skip__'
          const response = await fetch('/api/assign', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: ref.key, asset: skip ? undefined : select.value, skip }) })
          const body = await response.json()
          if (!response.ok) return say(body.message)
          board = body
          say('已更新 ' + ref.key)
        }
        card.append(el('div', { className: 'row' }, [text(ref.kind + ' ' + ref.name), select]))
      }
      panel.append(card)
    }
  }
  if (stage === 4) {
    picked = true
    next.disabled = false
    for (const shot of board.shots || []) {
      const input = el('input', { type: 'checkbox' })
      input.checked = Boolean(shot.ready)
      input.dataset.id = shot.id
      panel.append(el('label', {}, [input, text(' ' + shot.id + (shot.ready ? '' : '（参考图还没齐）'))]), el('br'))
    }
  }
}

next.onclick = async () => {
  if (stage === 1) {
    await refresh()
    if (!board.durationsChosen) {
      const durations = {}
      for (const input of panel.querySelectorAll('input[data-shot]')) {
        const value = String(input.value || '').trim()
        if (!value) continue
        durations[input.dataset.shot] = Number(value)
      }
      if (!Object.keys(durations).length) return say('请填写秒数，上传秒数表，或点「跳过秒数」。')
      next.disabled = true
      const response = await fetch('/api/durations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ durations }) })
      const body = await response.json()
      next.disabled = false
      if (!response.ok) return say(body.message)
      await refresh()
    }
    stage = 2
    picked = Boolean(board.assetsChosen)
    say('')
    render()
    return
  }
  if (stage < 3) {
    await refresh()
    stage += 1
    picked = stage === 2 ? Boolean(board.assetsChosen) : false
    say('')
    render()
    return
  }
  if (stage === 3) {
    await refresh()
    if (board.step === 'matching') return say(board.ask || '还有参考图没选定。')
    stage = 4
    say('')
    render()
    return
  }
  const ids = [...panel.querySelectorAll('input[type=checkbox]:checked')].map(input => input.dataset.id)
  if (!ids.length) return say('先勾选要填的分镜。')
  next.disabled = true
  say('正在填入即梦…')
  const response = await fetch('/api/fill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shotIds: ids, replace: note.dataset.replace === 'yes' }) })
  const body = await response.json()
  next.disabled = false
  if (!response.ok && body.code === 'EDITOR_NOT_EMPTY') {
    note.dataset.replace = 'yes'
    return say(body.message + ' 再点一次「填入即梦」会清空当前编辑器。')
  }
  if (!response.ok) return say(body.message)
  say('已经填进即梦。请看页面，确认后再决定要不要生成。')
  await fetch('/api/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filled: ids }) })
  next.disabled = true
}

refresh().then(() => { picked = Boolean(board.sourceName); render() }).catch(error => say(error.message))
</script>
</body>
</html>`
}

export async function startWizard({ port = 0, onRegenerate } = {}) {
  const root = join(tmpdir(), `jimeng-wizard-${randomUUID()}`)
  const assetDir = join(root, 'assets')
  await mkdir(assetDir, { recursive: true })
  let outcome = null
  let resolveFinished
  const finished = new Promise(resolve => { resolveFinished = resolve })
  const id = randomUUID()
  let notifier = null

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1')
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(wizardPage())
        return
      }
      if (req.method === 'GET' && url.pathname === '/api/board') {
        send(res, 200, { ok: true, ...(await wizardBoard()) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/storyboard') {
        const name = safeName(req.headers['x-filename'])
        if (!STORY_EXT.has(extname(name).toLowerCase())) throw coded('分镜文档支持 TXT、MD、DOCX。', 'DOCUMENT_TYPE')
        const file = join(root, name)
        await mkdir(join(file, '..'), { recursive: true })
        await writeFile(file, await readBody(req, 25 * 1024 * 1024))
        send(res, 200, { ok: true, ...(await loadStoryboard({ storyboardPath: file })) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/durations') {
        if (String(req.headers['content-type'] || '').includes('application/json')) {
          const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}')
          if (body.skip === true) {
            send(res, 200, { ok: true, ...(await loadDurations({ skip: true })) })
            return
          }
          if (body.durations && typeof body.durations === 'object') {
            send(res, 200, { ok: true, ...(await loadDurations({ durations: body.durations })) })
            return
          }
          throw coded('请给出秒数表、会话秒数表，或明确跳过。', 'DURATION_REQUIRED')
        }
        const name = safeName(req.headers['x-filename'])
        if (!DURATION_EXT.has(extname(name).toLowerCase())) throw coded('秒数表支持 xlsx 或 json。', 'DURATION_FILE')
        const file = join(root, name)
        await writeFile(file, await readBody(req, 25 * 1024 * 1024))
        send(res, 200, { ok: true, ...(await loadDurations({ durationsPath: file })) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/asset') {
        const name = safeName(req.headers['x-path'] || req.headers['x-filename'])
        if (!IMAGE_EXT.has(extname(name).toLowerCase())) throw coded('参考图只接收图片。', 'ASSET_TYPE')
        const file = join(assetDir, name)
        await mkdir(join(file, '..'), { recursive: true })
        await writeFile(file, await readBody(req, 40 * 1024 * 1024))
        send(res, 200, { ok: true })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/assets/done') {
        send(res, 200, { ok: true, ...(await loadAssets({ referencesDir: assetDir })) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/prompt') {
        const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}')
        send(res, 200, { ok: true, ...(await updateShotPrompt(body.shotId, body.prompt)) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/assign') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}')
        await assignReference({ ref: body.ref, asset: body.asset, skip: body.skip === true })
        send(res, 200, { ok: true, ...(await wizardBoard()) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/regenerate') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}')
        if (!onRegenerate) throw coded('这次会话不能在向导里调用模型。请直接改下面的文字。', 'NEED_MODEL')
        send(res, 200, { ok: true, ...(await onRegenerate(body.shotId)) })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/fill') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}')
        const shotIds = Array.isArray(body.shotIds) ? body.shotIds : []
        const filled = []
        for (const shotId of shotIds) {
          let ask = await wizardBoard()
          if (ask.step === 'confirm_matches') {
            await confirmMatches({ confirm: '确认匹配' })
            ask = await wizardBoard()
          }
          if (ask.step !== 'ready') throw coded(ask.ask || '还有步骤没完成。', 'NEED_ANSWER')
          filled.push(await fillJimeng({ shotId, replace: body.replace === true }))
        }
        send(res, 200, { ok: true, filled })
        return
      }
      if (req.method === 'POST' && url.pathname === '/api/done') {
        const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}')
        outcome = { filled: body.filled || [], completed: true }
        if (notifier) await notifier()
        resolveFinished(outcome)
        send(res, 200, { ok: true })
        return
      }
      send(res, 404, { ok: false, message: '没有这个地址。' })
    } catch (error) {
      if (!res.headersSent) await fail(res, error)
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    id,
    url: `http://127.0.0.1:${address.port}/`,
    finished,
    setNotifier(fn) { notifier = fn },
    outcome() { return outcome },
    stop() { return new Promise(resolve => server.close(resolve)) }
  }
}
