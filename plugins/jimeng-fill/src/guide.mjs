import { coded } from './errors.mjs'
import { chooseFile, chooseFolder } from './picker.mjs'
import {
  assignReference,
  confirmMatches,
  fillJimeng,
  loadAssets,
  loadDurations,
  loadStoryboard,
  updateShotPrompt,
  wizardBoard
} from './tools.mjs'

function messageText(result) {
  const content = result?.content
  const blocks = Array.isArray(content) ? content : [content]
  return blocks.map(block => block && typeof block.text === 'string' ? block.text : '').join('\n').trim()
}

function clip(text, max = 100) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

/** 把已读分镜整理成可直接贴进会话对话框的正文。 */
export function formatBoardPreview(board, { limit = 30 } = {}) {
  const shots = Array.isArray(board?.shots) ? board.shots : []
  if (!shots.length) return '还没有读入分镜。'
  const lines = shots.slice(0, limit).map((shot, index) => {
    const seconds = shot.duration ?? shot.suggestedDuration
    const secText = seconds != null ? `${seconds}秒` : '无秒数'
    const refs = (shot.refs || [])
      .filter(ref => ref?.name && ref.name !== '无')
      .map(ref => `${ref.kind}:${ref.name}`)
      .slice(0, 6)
      .join('，')
    const body = clip(shot.prompt, 120)
    return [
      `${index + 1}. ${shot.id}（${secText}${shot.title ? ` · ${shot.title}` : ''}）`,
      refs ? `   参考：${refs}` : null,
      body ? `   ${body}` : null
    ].filter(Boolean).join('\n')
  })
  const more = shots.length > limit ? `\n…还有 ${shots.length - limit} 条` : ''
  const extracted = board.extractedDurations && Object.keys(board.extractedDurations).length
    ? `\n标题抽出的秒数：${Object.entries(board.extractedDurations).map(([id, sec]) => `${id}=${sec}`).join('，')}`
    : ''
  return `已读入 ${board.sourceName || '分镜'}，共 ${shots.length} 条：\n\n${lines.join('\n')}${more}${extracted}`
}

function optionsFor(board) {
  if (!board?.step || board.step === 'storyboard') {
    return [
      { value: 'pick', title: '选择分镜文档（系统文件选择器）' },
      { value: 'path', title: '填写分镜文件路径' },
      { value: 'paste', title: '粘贴分镜全文' },
      { value: 'cancel', title: '取消' }
    ]
  }
  if (board.step === 'durations') {
    const extractedCount = Object.keys(board.extractedDurations || {}).length
    return [
      ...(extractedCount ? [{ value: 'use_title', title: `使用标题抽出的 ${extractedCount} 条秒数` }] : []),
      { value: 'edit', title: '在表单里改秒数' },
      { value: 'file', title: '选择秒数表文件（系统文件选择器）' },
      { value: 'skip', title: '跳过秒数表' },
      { value: 'cancel', title: '取消' }
    ]
  }
  if (board.step === 'assets') {
    return [
      { value: 'pick', title: '选择参考图文件夹（系统文件夹选择器）' },
      { value: 'path', title: '填写参考图文件夹路径' },
      { value: 'cancel', title: '取消' }
    ]
  }
  if (board.step === 'matching') {
    const choices = (board.choices || []).map((asset, index) => ({
      value: String(asset.id),
      title: `${index + 1}. ${asset.name}`
    }))
    return [...choices, { value: 'skip', title: '跳过这一条' }, { value: 'cancel', title: '取消' }]
  }
  if (board.step === 'confirm_matches') {
    return [
      { value: 'confirm', title: '确认匹配' },
      { value: 'cancel', title: '取消' }
    ]
  }
  if (board.step === 'ready') {
    const shots = (board.shots || []).slice(0, 20).map(shot => ({
      value: `fill:${shot.id}`,
      title: `填入 ${shot.id}${shot.ready ? '' : '（未就绪）'} · ${shot.duration ?? '?'}秒`
    }))
    return [
      ...shots,
      { value: 'fill_all_ready', title: '把所有就绪分镜依次填入即梦' },
      { value: 'done', title: '结束，不填入' },
      { value: 'cancel', title: '取消' }
    ]
  }
  return [{ value: 'cancel', title: '取消' }]
}

function matchReply(reply, options) {
  const text = String(reply || '').trim()
  if (!text) return null
  const exactValue = options.find(item => item.value === text)
  if (exactValue) return exactValue.value
  const exactTitle = options.find(item => item.title === text)
  if (exactTitle) return exactTitle.value
  const numbered = text.match(/^(\d+)\s*[.、.]?\s*(.*)$/)
  if (numbered) {
    const index = Number(numbered[1]) - 1
    if (index >= 0 && index < options.length && options[index].value !== 'cancel') {
      return options[index].value
    }
  }
  const soft = options.find(item => item.title.includes(text) || text.includes(item.title))
  return soft ? soft.value : null
}

function chatPause(board, extra = {}) {
  const preview = board?.shots?.length ? formatBoardPreview(board) : null
  const options = optionsFor(board)
  return {
    mode: 'chat',
    awaiting: true,
    cancelled: false,
    step: board?.step || 'storyboard',
    ask: board?.ask || '请选择下一步。',
    preview,
    options,
    ref: board?.ref || null,
    sourceName: board?.sourceName || null,
    message: [
      preview,
      board?.ask || '请选择下一步。',
      '',
      '请直接回复下面某一项（或回复编号）：',
      ...options.map((item, index) => `${index + 1}. ${item.title}`)
    ].filter(Boolean).join('\n'),
    ...extra
  }
}

async function safeBoard() {
  try {
    return await wizardBoard()
  } catch {
    return { step: 'storyboard', ask: '请先提供分镜文档路径，或粘贴全文。', shots: [], extractedDurations: {} }
  }
}

async function elicitForm(mcp, message, requestedSchema) {
  if (!mcp?.server?.elicitInput) return null
  try {
    return await mcp.server.elicitInput({ mode: 'form', message, requestedSchema })
  } catch {
    return null
  }
}

/** 会话内单选 + 确认（MCP form elicitation），不弹系统窗。 */
async function askChoice(mcp, message, options, { title = '请选择' } = {}) {
  const result = await elicitForm(mcp, message, {
    type: 'object',
    properties: {
      choice: {
        type: 'string',
        title,
        description: '点选一项后点确认。',
        oneOf: options.map(item => ({ const: item.value, title: item.title }))
      }
    },
    required: ['choice']
  })
  if (!result) return { ok: false, reason: 'no_elicitation' }
  if (result.action === 'cancel' || result.action === 'decline') return { ok: true, value: 'cancel' }
  if (result.action === 'accept' && result.content?.choice != null) {
    return { ok: true, value: String(result.content.choice) }
  }
  return { ok: true, value: 'cancel' }
}

async function askText(mcp, message, { title = '内容', defaultValue = '' } = {}) {
  const result = await elicitForm(mcp, message, {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        title,
        description: '填写后点确认。',
        default: defaultValue
      }
    },
    required: ['text']
  })
  if (!result) return { ok: false, reason: 'no_elicitation' }
  if (result.action === 'cancel' || result.action === 'decline') return { ok: true, value: null }
  if (result.action === 'accept') return { ok: true, value: String(result.content?.text ?? '') }
  return { ok: true, value: null }
}

async function askDurationsForm(mcp, board) {
  const properties = {}
  const required = []
  for (const shot of board.shots || []) {
    const key = `d_${String(shot.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`
    properties[key] = {
      type: 'number',
      title: `${shot.id} 秒数`,
      description: shot.title || shot.id,
      default: Number(shot.duration || shot.suggestedDuration || 5)
    }
    required.push(key)
  }
  const preview = formatBoardPreview(board)
  const result = await elicitForm(mcp, `${preview}\n\n请改各条秒数，然后点确认。`, {
    type: 'object',
    properties,
    required
  })
  if (!result) return { ok: false, reason: 'no_elicitation' }
  if (result.action !== 'accept' || !result.content) return { ok: true, value: null }
  const durations = {}
  for (const shot of board.shots || []) {
    const key = `d_${String(shot.id).replace(/[^a-zA-Z0-9_-]/g, '_')}`
    const value = result.content[key]
    if (value != null && value !== '') durations[shot.id] = value
  }
  return { ok: true, value: durations }
}

async function rewriteShot(mcp, shotId) {
  const board = await wizardBoard()
  const shot = board.shots.find(item => item.id === shotId)
  if (!shot) throw coded('分镜不存在，请重新加载分镜文档。', 'TASK_MISSING')
  let text = ''
  try {
    const result = await mcp.server.createMessage({
      maxTokens: 1200,
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `请重写这条短剧分镜的提示词。保留【角色】【场景】【道具】中的名字，补全画面、动作和光线。只输出分镜正文，不要解释。\n\n${shot.prompt}`
        }
      }]
    })
    text = messageText(result)
  } catch {
    throw coded('这次会话不能在向导里调用模型。请直接改下面的文字。', 'NEED_MODEL')
  }
  if (!text) throw coded('模型没有返回提示词。请直接改下面的文字。', 'NEED_MODEL')
  return updateShotPrompt(shotId, text)
}

async function applyAtReady(board, action, args, mcp) {
  const filled = []
  if (action === 'done') return { mode: 'form', awaiting: false, cancelled: false, filled, message: '已结束，没有继续填入。' }
  if (action === 'cancel') return { mode: 'form', awaiting: false, cancelled: true, filled, message: '已取消。' }
  if (action === 'fill_all_ready') {
    for (const shot of (board.shots || []).filter(item => item.ready)) {
      try {
        await fillJimeng({ shotId: shot.id, replace: args.replace === true })
        filled.push(shot.id)
      } catch (error) {
        if (error?.code === 'EDITOR_NOT_EMPTY') {
          const confirm = await askChoice(mcp, `${shot.id}：编辑器已有内容，是否清空后重填？`, [
            { value: 'replace', title: '清空并填入' },
            { value: 'skip', title: '跳过这一条' },
            { value: 'cancel', title: '取消' }
          ], { title: '确认' })
          if (!confirm.ok) throw coded('当前会话不支持表单选择。', 'NEED_ELICITATION')
          if (confirm.value === 'cancel') return { mode: 'form', awaiting: false, cancelled: false, filled }
          if (confirm.value !== 'replace') continue
          await fillJimeng({ shotId: shot.id, replace: true })
          filled.push(shot.id)
        } else {
          throw error
        }
      }
    }
    return { mode: 'form', awaiting: false, cancelled: false, filled, message: filled.length ? `已填入：${filled.join('、')}` : '没有可填的就绪分镜。' }
  }
  if (String(action).startsWith('fill:')) {
    const shotId = String(action).slice(5)
    try {
      await fillJimeng({ shotId, replace: args.replace === true })
      filled.push(shotId)
      return { continue: true, filled }
    } catch (error) {
      if (error?.code === 'EDITOR_NOT_EMPTY') {
        const confirm = await askChoice(mcp, `${shotId}：编辑器已有内容，是否清空后重填？`, [
          { value: 'replace', title: '清空并填入' },
          { value: 'skip', title: '跳过' },
          { value: 'cancel', title: '取消' }
        ], { title: '确认' })
        if (!confirm.ok) throw coded('当前会话不支持表单选择。', 'NEED_ELICITATION')
        if (confirm.value === 'replace') {
          await fillJimeng({ shotId, replace: true })
          filled.push(shotId)
          return { continue: true, filled }
        }
        if (confirm.value === 'cancel') return { mode: 'form', awaiting: false, cancelled: false, filled }
        return { continue: true, filled }
      }
      throw error
    }
  }
  if (action === 'regen' && args.shotId) {
    await rewriteShot(mcp, args.shotId)
    return { continue: true, filled }
  }
  return null
}

/**
 * 用 MCP 表单（单选 + 确认）在会话里连续走完向导；不弹系统窗、不打开浏览器。
 */
async function runFormGuide(mcp) {
  const filled = []
  while (true) {
    const board = await safeBoard()
    const options = optionsFor(board).filter(item => item.value !== 'cancel').concat([{ value: 'cancel', title: '取消' }])
    const preview = board.shots?.length ? formatBoardPreview(board) : null
    const heading = preview ? `${preview}\n\n` : ''
    const question = board.ask || '请选择下一步。'

    if (board.step === 'storyboard') {
      const picked = await askChoice(mcp, `${heading}${question}\n\n请点选一项后点确认。选「选择分镜文档」会弹出系统文件选择器。`, options, { title: '分镜来源' })
      if (!picked.ok) return null
      if (picked.value === 'cancel') return { mode: 'form', cancelled: true, filled, message: '已取消。' }
      if (picked.value === 'pick') {
        const storyboardPath = await chooseFile('选择分镜文档（TXT / MD / DOCX）')
        if (!storyboardPath) return { mode: 'form', cancelled: true, filled, message: '已取消选择分镜。' }
        await loadStoryboard({ storyboardPath })
        continue
      }
      if (picked.value === 'path') {
        const pathAsk = await askText(mcp, '请填写分镜文件的绝对路径（TXT / MD / DOCX），然后点确认。', { title: '分镜文件路径' })
        if (!pathAsk.ok) return null
        if (!pathAsk.value) return { mode: 'form', cancelled: true, filled, message: '已取消。' }
        await loadStoryboard({ storyboardPath: pathAsk.value.trim() })
        continue
      }
      if (picked.value === 'paste') {
        const textAsk = await askText(mcp, '请粘贴分镜全文，然后点确认。', { title: '分镜全文' })
        if (!textAsk.ok) return null
        if (!textAsk.value) return { mode: 'form', cancelled: true, filled, message: '已取消。' }
        await loadStoryboard({ text: textAsk.value })
        continue
      }
      continue
    }

    if (board.step === 'durations') {
      const picked = await askChoice(mcp, `${heading}${question}\n\n请点选一项后点确认。`, options, { title: '秒数表' })
      if (!picked.ok) return null
      if (picked.value === 'cancel') return { mode: 'form', cancelled: true, filled, message: '已取消。' }
      if (picked.value === 'skip') await loadDurations({ skip: true })
      else if (picked.value === 'use_title') await loadDurations({ durations: board.extractedDurations })
      else if (picked.value === 'file') {
        const durationsPath = await chooseFile('选择秒数表（xlsx / json）')
        if (!durationsPath) return { mode: 'form', cancelled: true, filled, message: '已取消选择秒数表。' }
        await loadDurations({ durationsPath })
      } else if (picked.value === 'edit') {
        const edited = await askDurationsForm(mcp, board)
        if (!edited.ok) return null
        if (!edited.value) return { mode: 'form', cancelled: true, filled, message: '已取消。' }
        await loadDurations({ durations: edited.value })
      }
      continue
    }

    if (board.step === 'assets') {
      const picked = await askChoice(mcp, `${heading}${question}\n\n请点选一项后点确认。选「选择参考图文件夹」会弹出系统文件夹选择器。`, options, { title: '参考图' })
      if (!picked.ok) return null
      if (picked.value === 'cancel') return { mode: 'form', cancelled: true, filled, message: '已取消。' }
      if (picked.value === 'pick') {
        const referencesDir = await chooseFolder('选择参考图文件夹')
        if (!referencesDir) return { mode: 'form', cancelled: true, filled, message: '已取消选择参考图文件夹。' }
        await loadAssets({ referencesDir })
        continue
      }
      const pathAsk = await askText(mcp, `${heading}请填写参考图文件夹绝对路径，然后点确认。`, { title: '参考图文件夹' })
      if (!pathAsk.ok) return null
      if (!pathAsk.value) return { mode: 'form', cancelled: true, filled, message: '已取消。' }
      await loadAssets({ referencesDir: pathAsk.value.trim() })
      continue
    }

    if (board.step === 'matching') {
      const picked = await askChoice(mcp, `${heading}${board.ask}\n\n请点选一项后点确认。`, options, { title: '匹配参考图' })
      if (!picked.ok) return null
      if (picked.value === 'cancel') return { mode: 'form', cancelled: true, filled, message: '已取消。' }
      if (picked.value === 'skip') await assignReference({ ref: board.ref, skip: true })
      else await assignReference({ ref: board.ref, asset: picked.value })
      continue
    }

    if (board.step === 'confirm_matches') {
      const picked = await askChoice(mcp, `${heading}${board.ask}\n\n请点选后点确认。`, options, { title: '确认匹配' })
      if (!picked.ok) return null
      if (picked.value === 'cancel') return { mode: 'form', cancelled: true, filled, message: '已取消。' }
      if (picked.value === 'confirm') await confirmMatches({ confirm: '确认匹配' })
      continue
    }

    if (board.step === 'ready') {
      const readyOptions = [
        ...options.filter(item => item.value !== 'cancel' && item.value !== 'done'),
        { value: 'edit_prompt', title: '手改某一条提示词' },
        { value: 'regen', title: '让 Codex 补充某一条' },
        { value: 'done', title: '结束，不填入' },
        { value: 'cancel', title: '取消' }
      ]
      const picked = await askChoice(mcp, `${heading}分镜已就绪。请点选下一步后点确认。`, readyOptions, { title: '填入即梦' })
      if (!picked.ok) return null
      if (picked.value === 'cancel') return { mode: 'form', cancelled: true, filled, message: '已取消。' }
      if (picked.value === 'done') {
        return { mode: 'form', cancelled: false, filled, message: filled.length ? `已填入：${filled.join('、')}` : '已结束，没有填入。' }
      }
      if (picked.value === 'edit_prompt' || picked.value === 'regen') {
        const shotAsk = await askText(mcp, `${heading}请填写分镜编号，例如 1-1，然后点确认。`, { title: '分镜编号' })
        if (!shotAsk.ok) return null
        if (!shotAsk.value) continue
        const shotId = shotAsk.value.trim()
        if (picked.value === 'regen') {
          await rewriteShot(mcp, shotId)
          continue
        }
        const current = (await safeBoard()).shots.find(item => item.id === shotId)
        const next = await askText(mcp, `手改分镜 ${shotId} 的提示词，然后点确认。`, {
          title: '提示词',
          defaultValue: current?.prompt || ''
        })
        if (!next.ok) return null
        if (next.value == null) continue
        await updateShotPrompt(shotId, next.value)
        continue
      }
      const result = await applyAtReady(board, picked.value, {}, mcp)
      if (!result) continue
      if (result.filled) filled.push(...result.filled.filter(id => !filled.includes(id)))
      if (result.continue) continue
      return { ...result, filled: result.filled || filled }
    }

    return chatPause(board)
  }
}

async function runChatResume(mcp, args) {
  let board = await safeBoard()
  const replyText = args.reply ?? args.action ?? null
  const path = args.path || args.storyboardPath || args.durationsPath || args.referencesDir || null
  const pasted = args.text || null
  const options = optionsFor(board)
  let action = replyText ? matchReply(replyText, options) : null

  if (!action && replyText) {
    if (/清空并填入|replace/i.test(replyText)) action = 'replace'
    if (/^跳过$|^skip$/i.test(replyText)) action = 'skip'
  }

  if (board.step === 'storyboard' && (path || pasted)) {
    await loadStoryboard(path ? { storyboardPath: path } : { text: pasted })
    board = await safeBoard()
    return chatPause(board)
  }

  if (!replyText && !path && !pasted && !args.shotId && args.replace == null) {
    return chatPause(board)
  }

  if (board.step === 'storyboard') {
    if (action === 'cancel') return { mode: 'chat', awaiting: false, cancelled: true, message: '已取消。' }
    return chatPause(board)
  }

  if (board.step === 'durations') {
    if (action === 'cancel') return { mode: 'chat', awaiting: false, cancelled: true, message: '已取消。' }
    if (action === 'skip') await loadDurations({ skip: true })
    else if (action === 'use_title') await loadDurations({ durations: board.extractedDurations })
    else if (action === 'file') {
      if (!path) return chatPause(board, { message: `${formatBoardPreview(board)}\n\n请先提供秒数表路径。` })
      await loadDurations({ durationsPath: path })
    } else if (action === 'edit') {
      if (args.durations && typeof args.durations === 'object') await loadDurations({ durations: args.durations })
      else {
        return {
          mode: 'chat',
          awaiting: true,
          cancelled: false,
          step: 'durations_edit',
          preview: formatBoardPreview(board),
          extractedDurations: board.extractedDurations || {},
          message: `${formatBoardPreview(board)}\n\n请回复秒数 JSON，例如 {"1-1":20,"1-2":15}。`
        }
      }
    } else if (args.durations && typeof args.durations === 'object') {
      await loadDurations({ durations: args.durations })
    } else if (!action) {
      return chatPause(board)
    } else {
      return chatPause(board, { message: `${formatBoardPreview(board)}\n\n没识别到选项「${replyText}」。` })
    }
    return chatPause(await safeBoard())
  }

  if (board.step === 'assets') {
    if (action === 'cancel') return { mode: 'chat', awaiting: false, cancelled: true, message: '已取消。' }
    if (!path) return chatPause(board)
    await loadAssets({ referencesDir: path })
    return chatPause(await safeBoard())
  }

  if (board.step === 'matching') {
    if (action === 'cancel') return { mode: 'chat', awaiting: false, cancelled: true, message: '已取消。' }
    if (action === 'skip') await assignReference({ ref: board.ref, skip: true })
    else if (action) await assignReference({ ref: board.ref, asset: action })
    else return chatPause(board)
    return chatPause(await safeBoard())
  }

  if (board.step === 'confirm_matches') {
    if (action === 'confirm' || replyText === '确认匹配') {
      await confirmMatches({ confirm: '确认匹配' })
      return chatPause(await safeBoard())
    }
    if (action === 'cancel') return { mode: 'chat', awaiting: false, cancelled: true, message: '已取消。' }
    return chatPause(board)
  }

  if (board.step === 'ready') {
    if (args.shotId && (action === 'regen' || args.regen === true)) action = 'regen'
    if (action === 'replace' || (args.replace === true && args.shotId)) {
      await fillJimeng({ shotId: args.shotId, replace: true })
      return chatPause(await safeBoard(), { filled: [args.shotId], message: `已清空并填入 ${args.shotId}。` })
    }
    if (!action && replyText && /^\d+-\d+/.test(replyText.trim())) {
      action = `fill:${replyText.trim().split(/\s+/)[0]}`
    }
    if (action === 'regen') {
      const shotId = args.shotId || (replyText && /^\d+-\d+/.test(replyText.trim()) ? replyText.trim().split(/\s+/)[0] : null)
      if (!shotId) return chatPause(board, { message: `${formatBoardPreview(board)}\n\n请回复要补充的分镜编号。` })
      if (!mcp) throw coded('当前没有会话模型，无法重新生成。', 'NEED_MODEL')
      await rewriteShot(mcp, shotId)
      return chatPause(await safeBoard())
    }
    if (action === 'done') return { mode: 'chat', awaiting: false, cancelled: false, filled: [], message: '已结束。' }
    if (action === 'cancel') return { mode: 'chat', awaiting: false, cancelled: true, message: '已取消。' }
    if (action === 'fill_all_ready' || String(action || '').startsWith('fill:')) {
      const result = await applyAtReady(board, action, args, mcp)
      if (result?.continue) return chatPause(await safeBoard(), { filled: result.filled })
      if (result) return result
    }
    return chatPause(board)
  }

  return chatPause(board)
}

/**
 * 官方 Codex：优先会话内表单（单选 + 确认）；不弹系统窗、不打开浏览器。
 * 无参且支持 elicitation 时，在一次工具调用里连续问完。
 * 带 reply/path/text 时按聊天续跑；不支持表单时退回 chat 选项列表。
 */
export async function runGuide(mcp = null, args = {}) {
  if (process.env.JIMENG_UI === 'workbench') {
    return {
      embed: 'workbench',
      message: '请在 Codex 工作台侧栏「即梦填图词」面板里选文件。'
    }
  }

  const hasResume = Boolean(
    args.reply || args.action || args.path || args.storyboardPath || args.durationsPath
    || args.referencesDir || args.text || args.shotId || args.durations || args.replace != null || args.regen
  )

  if (!hasResume && mcp?.server?.elicitInput) {
    const formResult = await runFormGuide(mcp)
    if (formResult) return formResult
  }

  return runChatResume(mcp, args)
}
