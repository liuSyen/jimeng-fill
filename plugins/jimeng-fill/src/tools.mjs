import { extractedDurationsFromTasks, normalizeDurationMap, readDurationTable } from './durations.mjs'
import { coded } from './errors.mjs'
import { scanReferences } from './assets.mjs'
import { capturePage, clickGenerate, fillShot, openEditor, requestStop } from './fill.mjs'
import { jimengPage, pageCall } from './browser.mjs'
import { matchStoryboard, parseStoryboard, readStoryboardFile } from './storyboard.mjs'
import { loadState, saveState } from './state.mjs'

function attachEvidence(tasks, assets) {
  return tasks.map(task => ({
    ...task,
    assetEvidence: (task.matches || []).flatMap(match => {
      if (match.assetId == null) return []
      const asset = assets.find(item => String(item.id) === String(match.assetId))
      return asset ? [{ id: asset.id, name: asset.name, sha256: asset.sha256 }] : []
    })
  }))
}

function assetName(assets, id) {
  return assets.find(item => String(item.id) === String(id))?.name || null
}

function viewShot(task, durations, withPrompt) {
  const suggested = task.suggestedDuration != null ? task.suggestedDuration : null
  const chosen = durations && Object.hasOwn(durations, task.id) ? durations[task.id] : null
  return {
    id: task.id,
    title: task.title,
    episode: task.episode,
    shot: task.shot,
    ready: Boolean(task.ready),
    duration: chosen != null ? chosen : suggested,
    suggestedDuration: suggested,
    validationErrors: task.validationErrors || [],
    promptLength: String(task.prompt || '').length,
    ...(withPrompt ? { prompt: task.prompt } : {}),
    refs: (task.matches || []).map(match => ({
      kind: match.kind,
      name: match.name,
      status: match.status,
      assetId: match.assetId ?? null,
      assetName: match.assetId == null ? null : assetName(task.assetEvidence || [], match.assetId) || match.name
    }))
  }
}

function issues(state) {
  const rows = []
  for (const task of state.tasks) {
    for (const match of task.matches || []) {
      if (!['missing', 'ambiguous'].includes(match.status)) continue
      rows.push({
        shotId: task.id,
        kind: match.kind,
        name: match.name,
        status: match.status,
        candidates: (match.candidates || []).map(id => ({ id, name: assetName(state.assets, id) }))
      })
    }
  }
  return rows
}

function applyIgnored(tasks, ignored) {
  const skipped = new Set(ignored || [])
  return tasks.map(task => {
    const matches = (task.matches || []).map(match => {
      if (!skipped.has(`${match.kind}:${match.name}`)) return match
      return { ...match, status: 'ignored', assetId: undefined, candidates: [] }
    })
    const validationErrors = Array.isArray(task.validationErrors) ? task.validationErrors : []
    const ready = Boolean(String(task.prompt || '').trim()) && !validationErrors.length && matches.every(match => match.kind === '道具' || match.optional || ['exact', 'normalized', 'manual', 'ignored'].includes(match.status))
    return { ...task, matches, ready }
  })
}

function rematch(state) {
  const matched = matchStoryboard(state.tasks, state.assets, state.overrides)
  state.tasks = attachEvidence(applyIgnored(matched.tasks, state.ignoredRefs), state.assets)
  return matched.summary
}

function pendingRefs(state) {
  const byKey = new Map()
  for (const task of state.tasks) {
    for (const match of task.matches || []) {
      if (!['missing', 'ambiguous'].includes(match.status)) continue
      const key = `${match.kind}:${match.name}`
      const row = byKey.get(key) || { key, kind: match.kind, name: match.name, status: match.status, candidates: match.candidates || [], shots: [] }
      if (!row.shots.includes(task.id)) row.shots.push(task.id)
      if (match.status === 'ambiguous') row.status = 'ambiguous'
      byKey.set(key, row)
    }
  }
  const rank = { 角色: 0, 场景: 1, 道具: 2 }
  return [...byKey.values()].sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || a.name.localeCompare(b.name, 'zh'))
}

function numbered(rows) {
  return rows.map((row, index) => `${index + 1}. ${row.id}${row.name && row.name !== row.id ? `（${row.name}）` : ''}`).join('\n')
}

export function nextAsk(state) {
  if (!state?.sourceName || !state.tasks?.length) {
    return { step: 'storyboard', ask: '请先选择要导入的分镜文档，支持 TXT、MD、DOCX，也可以直接把全文贴过来。' }
  }
  if (!state.durationsChosen) {
    const extracted = extractedDurationsFromTasks(state.tasks)
    const hint = Object.keys(extracted).length
      ? `标题里已抽出 ${Object.keys(extracted).length} 条秒数，可在会话里直接改或选用。`
      : '没有秒数表就在会话里手填，或回复“跳过秒数表”。'
    return { step: 'durations', ask: `上面是已读入的分镜内容（${state.sourceName}，共 ${state.tasks.length} 条）。请在对话框里选择：用标题秒数、改秒数、附上秒数表，或跳过。${hint}` }
  }
  if (!state.assetsChosen) {
    return { step: 'assets', ask: '请在对话框里用「+」附上这一部的参考图文件夹，或发送文件夹路径。' }
  }
  const pending = pendingRefs(state)[0]
  if (pending) {
    const where = pending.shots.slice(0, 8).join('、')
    const library = pending.status === 'ambiguous'
      ? (pending.candidates || []).map(id => state.assets.find(asset => String(asset.id) === String(id))).filter(Boolean)
      : state.assets.slice(0, 15)
    const choices = library.length ? `\n${numbered(library)}` : ''
    const more = pending.status === 'missing' && state.assets.length > library.length ? `\n目录里还有 ${state.assets.length - library.length} 张，上面只列出一部分。` : ''
    const tail = pending.status === 'ambiguous'
      ? '请回复编号或路径。'
      : '请回复要用的编号或路径。这张图确实没有就回复“跳过”。'
    return {
      step: 'matching',
      ref: pending.key,
      status: pending.status,
      choices: library.map(asset => ({ id: asset.id, name: asset.name })),
      ask: `${pending.kind}「${pending.name}」用在 ${where}。${pending.status === 'ambiguous' ? '有多张同名图，不能代你挑。' : '没有同名图。'}${choices}${more}\n${tail}`
    }
  }
  if (!state.matchesConfirmed) {
    const paired = []
    const seen = new Set()
    for (const task of state.tasks) {
      for (const match of task.matches || []) {
        const key = `${match.kind}:${match.name}`
        if (seen.has(key) || !['exact', 'normalized', 'manual'].includes(match.status)) continue
        seen.add(key)
        paired.push(`${match.kind}「${match.name}」→ ${assetName(state.assets, match.assetId) || match.assetId}`)
      }
    }
    const list = paired.length ? paired.slice(0, 30).join('\n') : '没有需要配的参考图。'
    return { step: 'confirm_matches', ask: `参考图目前是这样配的：\n${list}\n要改哪条就说「角色:名字 改成 文件路径」。没问题就回复“确认匹配”。` }
  }
  return { step: 'ready', ask: '要填哪一条？请给分镜编号，例如 1-1。编辑器里如果已有内容，会再问你要不要清空。' }
}

function withAsk(state, extra = {}) {
  return { ...extra, ...nextAsk(state) }
}

export async function loadStoryboard(args) {
  if (args.referencesDir || args.durationsPath) {
    throw coded('请一次只做一步。先只导入分镜文档；秒数表和参考图目录等问过用户再收。', 'STEP_BY_STEP')
  }
  if (Boolean(args.text) === Boolean(args.storyboardPath)) {
    throw coded('请提供分镜文本或文件路径里的一个。', 'DOCUMENT_REQUIRED')
  }
  const source = args.storyboardPath ? await readStoryboardFile(args.storyboardPath) : { name: '粘贴文本', text: String(args.text) }
  const parsed = parseStoryboard(source.text)
  const state = {
    schemaVersion: 1,
    sourceName: source.name,
    tasks: parsed.tasks,
    assets: [],
    overrides: {},
    warnings: parsed.warnings || [],
    durations: null,
    durationName: null,
    durationsChosen: false,
    assetsChosen: false,
    referencesDir: null,
    ignoredRefs: [],
    matchesConfirmed: false,
    uncertainUpload: false,
    lastFill: null,
    updatedAt: null
  }
  await saveState(state)
  const extractedDurations = extractedDurationsFromTasks(state.tasks)
  return withAsk(state, {
    sourceName: source.name,
    shotCount: state.tasks.length,
    warnings: state.warnings,
    extractedDurations,
    extractedCount: Object.keys(extractedDurations).length
  })
}

export async function loadDurations(args) {
  const state = await loadState()
  const ask = nextAsk(state)
  if (ask.step === 'storyboard') throw coded(ask.ask, 'NEED_ANSWER')
  if (args.referencesDir) throw coded('参考图目录等这一步问完再选。', 'STEP_BY_STEP')
  const inline = args.durations && typeof args.durations === 'object' ? args.durations : null
  const sources = [args.skip === true, Boolean(args.durationsPath), Boolean(inline)].filter(Boolean).length
  if (sources > 1) throw coded('跳过、秒数表文件和会话秒数表只能选一种。', 'DURATION_FILE')
  if (sources === 0) throw coded('请给出秒数表路径、会话秒数表，或明确跳过。', 'DURATION_REQUIRED')
  if (args.skip === true) {
    state.durations = null
    state.durationName = null
  } else if (inline) {
    const table = normalizeDurationMap(inline, '会话编辑')
    state.durations = table.durations
    state.durationName = table.name
    state.warnings = [...new Set([...(state.warnings || []), ...(table.warnings || [])])]
  } else {
    const table = await readDurationTable(args.durationsPath)
    state.durations = table.durations
    state.durationName = table.name
    state.warnings = [...new Set([...(state.warnings || []), ...(table.warnings || [])])]
  }
  state.durationsChosen = true
  state.matchesConfirmed = false
  if (state.assetsChosen) rematch(state)
  await saveState(state)
  const missingDuration = state.durations ? state.tasks.filter(task => !Object.hasOwn(state.durations, task.id)).map(task => task.id) : []
  return withAsk(state, { durationName: state.durationName, durationCount: state.durations ? Object.keys(state.durations).length : 0, missingDuration, skipped: args.skip === true })
}

export async function loadAssets(args) {
  const state = await loadState()
  const ask = nextAsk(state)
  if (ask.step === 'storyboard' || ask.step === 'durations') throw coded(ask.ask, 'NEED_ANSWER')
  if (!args.referencesDir) throw coded('请给出参考图文件夹路径。', 'ASSET_DIR')
  const assets = await scanReferences(args.referencesDir)
  state.assets = assets.map(asset => ({ id: asset.id, name: asset.name, path: asset.path, size: asset.size, sha256: asset.sha256 }))
  state.referencesDir = args.referencesDir
  state.assetsChosen = true
  state.overrides = {}
  state.ignoredRefs = []
  state.matchesConfirmed = false
  const summary = rematch(state)
  await saveState(state)
  return withAsk(state, { referencesDir: args.referencesDir, assetCount: state.assets.length, summary })
}

export async function confirmMatches(args) {
  const state = await loadState()
  const ask = nextAsk(state)
  if (ask.step !== 'confirm_matches') throw coded(ask.ask, 'NEED_ANSWER')
  if (args.confirm !== '确认匹配') throw coded('还没确认参考图搭配。请把上面的问题原样问用户。', 'MATCH_NOT_CONFIRMED')
  state.matchesConfirmed = true
  await saveState(state)
  return withAsk(state, { matchesConfirmed: true })
}

export async function currentAsk() {
  const state = await loadState()
  return nextAsk(state)
}

export async function wizardBoard() {
  const state = await loadState()
  const extractedDurations = extractedDurationsFromTasks(state.tasks)
  return {
    ...nextAsk(state),
    sourceName: state.sourceName,
    durationName: state.durationName,
    durationsChosen: Boolean(state.durationsChosen),
    assetsChosen: Boolean(state.assetsChosen),
    assetCount: state.assets.length,
    assets: state.assets.map(asset => ({ id: asset.id, name: asset.name })),
    extractedDurations,
    shots: state.tasks.map(task => ({
      ...viewShot(task, state.durations, true),
      refs: (task.matches || []).map(match => ({
        key: `${match.kind}:${match.name}`,
        kind: match.kind,
        name: match.name,
        status: match.status,
        assetId: match.assetId ?? null,
        optional: Boolean(match.optional) || match.kind === '道具'
      }))
    }))
  }
}

export async function updateShotPrompt(shotId, prompt) {
  const state = await loadState()
  const task = state.tasks.find(item => item.id === shotId)
  if (!task) throw coded('分镜不存在，请重新加载分镜文档。', 'TASK_MISSING')
  const parsed = parseStoryboard(String(prompt || ''))
  const next = parsed.tasks[0]
  if (!next || !String(next.prompt || '').trim()) throw coded('提示词是空的。', 'PROMPT_EMPTY')
  task.prompt = next.prompt
  if (Array.isArray(next.refs)) task.refs = next.refs
  state.matchesConfirmed = false
  state.lastFill = null
  rematch(state)
  await saveState(state)
  return wizardBoard()
}

export async function listShots(args = {}) {
  const state = await loadState()
  let shots = state.tasks
  if (args.episode != null) shots = shots.filter(task => task.episode === args.episode)
  if (args.readyOnly) shots = shots.filter(task => task.ready)
  return withAsk(state, {
    sourceName: state.sourceName,
    total: state.tasks.length,
    shown: shots.length,
    uncertainUpload: state.uncertainUpload,
    shots: shots.map(task => viewShot(task, state.durations, false))
  })
}

export async function showShot(shotId) {
  const state = await loadState()
  const task = state.tasks.find(item => item.id === shotId)
  if (!task) throw coded('分镜不存在，请重新加载文档。', 'TASK_MISSING')
  return withAsk(state, viewShot(task, state.durations, true))
}

export async function assignReference(args) {
  const state = await loadState()
  const ask = nextAsk(state)
  if (ask.step === 'storyboard' || ask.step === 'durations' || ask.step === 'assets') throw coded(ask.ask, 'NEED_ANSWER')
  const parts = String(args.ref || '').split(':')
  let kind = parts.shift()
  const name = parts.join(':').trim()
  if (kind === '人物') kind = '角色'
  if (!['角色', '场景', '道具'].includes(kind) || !name) throw coded('手动指定请写成“角色:名字”。', 'OVERRIDE_INVALID')
  const key = `${kind}:${name}`
  const mentioned = state.tasks.some(task => (task.refs || task.matches || []).some(ref => ref.kind === kind && ref.name === name))
  if (!mentioned) throw coded(`当前分镜里没有 ${key}。`, 'OVERRIDE_UNKNOWN')
  const skip = args.skip === true || args.asset === '跳过'
  let chosen = null
  if (skip) {
    if (!state.ignoredRefs.includes(key)) state.ignoredRefs.push(key)
    delete state.overrides[key]
  } else {
    const matches = state.assets.filter(asset => asset.id === args.asset || asset.name === args.asset)
    if (matches.length !== 1) {
      throw coded(matches.length ? `有 ${matches.length} 个同名参考图，请改用相对路径。` : '参考图目录里没有这张图。', 'OVERRIDE_AMBIGUOUS')
    }
    chosen = matches[0]
    state.ignoredRefs = (state.ignoredRefs || []).filter(item => item !== key)
    state.overrides[key] = chosen.id
  }
  state.matchesConfirmed = false
  const summary = rematch(state)
  state.lastFill = null
  await saveState(state)
  return withAsk(state, {
    ref: key,
    assetId: chosen ? chosen.id : null,
    assetName: chosen ? chosen.name : null,
    skipped: skip,
    summary,
    issues: issues(state).slice(0, 40)
  })
}

export async function acknowledgePage() {
  const state = await loadState()
  state.uncertainUpload = false
  await saveState(state)
  return { uncertainUpload: false, message: '已清除上传未确认标记。请先看一眼页面，再决定要不要重新填入。' }
}

export async function openJimeng() {
  return openEditor()
}

function projectInspect(view) {
  if (!view?.editorFound) {
    return { editorFound: false, url: view?.url || null, code: view?.code || 'EDITOR_NOT_FOUND', message: view?.message || '没有找到即梦视频编辑器。请确认已经打开视频生成。' }
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

export async function inspectJimeng() {
  const page = await jimengPage({ open: true })
  return projectInspect(await pageCall(page, 'inspect'))
}

export async function screenshotJimeng() {
  return capturePage()
}

function requireReady(state) {
  const ask = nextAsk(state)
  if (ask.step !== 'ready') throw coded(ask.ask, 'NEED_ANSWER')
}

export async function fillJimeng(args) {
  const state = await loadState()
  requireReady(state)
  return fillShot(state, {
    shotId: args.shotId,
    replace: args.replace === true,
    imageLimit: args.imageLimit ?? null,
    promptOnly: false
  })
}

export async function fillPrompt(args) {
  const state = await loadState()
  requireReady(state)
  return fillShot(state, { shotId: args.shotId, promptOnly: true })
}

export async function generateJimeng(args) {
  if (args.confirm !== '确认生成') throw coded('未确认生成，没有点击。', 'GENERATE_NOT_CONFIRMED')
  const state = await loadState()
  requireReady(state)
  return clickGenerate(state, args.shotId)
}

export async function stopJimeng() {
  requestStop()
  try {
    const page = await jimengPage({ open: false })
    await pageCall(page, 'stop')
  } catch {
    // 没有页面时只记下停止标记。
  }
  return { stopped: true, message: '已要求停止。已经写进页面的文字和图片会保留。' }
}
