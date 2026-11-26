// 这段函数会被整段送进即梦页面执行，不能引用 Node 模块。
export function installJimengPageApi() {
  const BUILD = '0.1.2'
  const previous = globalThis.__jimengCodex
  if (previous?.build === BUILD) return { ok: true, installed: true, build: BUILD }
  if (previous?.pin) return { ok: false, code: 'FILL_RUNNING', message: '页面上一次填写尚未结束。' }

  class StepError extends Error {
    constructor(message, code = 'FILL_FAILED') {
      super(message)
      this.code = code
    }
  }

  const tidy = value => String(value || '').replace(/\s+/g, ' ').trim()
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  const normalize = value => String(value || '').replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  const verify = value => normalize(value).replace(/\u00a0/g, ' ').replace(/^[\n]+|[ \t\n]+$/g, '').replace(/\n+/g, '\n')
  const api = { build: BUILD, pin: null, stopped: false, interrupted: false, ownDepth: 0, expectedPrompt: '', expectedDuration: null, clearing: false, writeTarget: null, writeBefore: null, input: null }

  function visible(element) {
    if (!element?.isConnected || element.closest('[hidden],[aria-hidden="true"]')) return false
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
  }
  function only(rows, message) {
    if (rows.length !== 1) throw new StepError(message + '（当前 ' + rows.length + ' 个）', 'COMPOSER_AMBIGUOUS')
    return rows[0]
  }
  function composer() {
    const videos = [...document.querySelectorAll('[data-testid="dreamina.generator"][data-generator-type="video"]')].filter(visible)
    if (!videos.length) {
      const others = [...document.querySelectorAll('[data-testid="dreamina.generator"]')].filter(visible)
      if (others.length) {
        const creation = [...others[0].querySelectorAll('[role="combobox"][aria-label="创作类型"]')].filter(visible)[0]
        const label = tidy(creation?.innerText || creation?.textContent || others[0].getAttribute('data-generator-type') || '其他模式')
        throw new StepError('当前不是视频生成（现在是 ' + label + '）。请先在即梦把创作类型切换成视频生成，再填图词。', 'VIDEO_MODE_REQUIRED')
      }
      throw new StepError('没有找到即梦生成区域。请确认已经登录并打开创作页。', 'EDITOR_NOT_FOUND')
    }
    const roots = videos.filter(element => element.getAttribute('role') === 'region' && element.getAttribute('aria-label') === '生成')
    const region = only(roots, '没有确认唯一的视频生成区域')
    const editor = only([...region.querySelectorAll('[contenteditable="true"][role="textbox"][aria-label="提示词"]')].filter(visible), '没有确认唯一的提示词输入框')
    const references = only([...region.querySelectorAll('[data-content-generator-references]')].filter(visible), '没有确认唯一的参考素材区域')
    const model = only([...region.querySelectorAll('[role="combobox"][aria-label="模型"]')].filter(visible), '没有确认当前视频模型')
    const mode = only([...region.querySelectorAll('[role="combobox"]:not([aria-label])')].filter(visible), '没有确认唯一的参考模式')
    return { root: region, editor, references, model, mode }
  }
  function contextOf(scope) {
    return JSON.stringify([
      location.href,
      scope.root.getAttribute('data-generator-type') || 'video',
      tidy(scope.model.innerText || scope.model.textContent),
      tidy(scope.mode.innerText || scope.mode.textContent)
    ])
  }
  function removeDecorations(clone) {
    clone.querySelectorAll('.rich-placeholder-widget,.document-placeholder-widget.ProseMirror-widget[contenteditable="false"],.ProseMirror-separator,.ProseMirror-trailingBreak,.node-reference-mention-tag,node-reference-mention-tag,[data-type="node-reference-mention-tag"],[data-node-type="node-reference-mention-tag"]').forEach(element => element.remove())
    return clone
  }
  function readPrompt(editor) {
    const clone = removeDecorations(editor.cloneNode(true))
    const blocks = new Set(['P', 'DIV', 'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'])
    const textOf = node => {
      if (node.nodeType === 3) return node.nodeValue || ''
      if (node.nodeType !== 1) return ''
      if (node.tagName === 'BR') return '\n'
      let text = ''
      for (const child of node.childNodes) {
        const block = child.nodeType === 1 && blocks.has(child.tagName)
        if (block && text && !text.endsWith('\n')) text += '\n'
        text += textOf(child)
        if (block && !text.endsWith('\n')) text += '\n'
      }
      return text
    }
    return normalize(textOf(clone))
  }
  function attachments(scope) {
    const rows = []
    const refs = scope.references
    const removeSelector = '[data-native-reference-action="remove"]'
    const mediaSelector = 'img:not(.ProseMirror-separator),video,canvas,[style*="background-image"]'
    const add = (element, remove) => {
      const image = element.querySelector('img:not(.ProseMirror-separator)')
      const indexed = element.closest('[data-index]')
      const raw = indexed && indexed !== refs && refs.contains(indexed) ? indexed.getAttribute('data-index') : null
      const index = raw !== null && /^\d+$/.test(raw) ? Number(raw) : rows.length
      rows.push({ element, remove, index, source: image ? (image.currentSrc || image.getAttribute('src') || '') : '', loaded: Boolean(image && image.complete && image.naturalWidth > 0) })
    }
    for (const remove of refs.querySelectorAll(removeSelector)) {
      let element = remove.parentElement
      while (element && element !== refs && (!element.querySelector(mediaSelector) || element.querySelectorAll(removeSelector).length !== 1)) element = element.parentElement
      if (!element || (element === refs && refs.querySelectorAll(removeSelector).length !== 1)) element = remove.closest('[aria-roledescription="sortable"]') || remove.parentElement
      if (element && refs.contains(element)) add(element, remove)
    }
    for (const element of refs.querySelectorAll('[data-index]')) {
      if (rows.some(row => element.contains(row.remove) || row.element.contains(element)) || element.querySelector('[class*="expand-entry-"]') || element.matches('[class*="expand-entry-"]')) continue
      if (element.querySelectorAll(mediaSelector).length !== 1 || element.querySelector('[data-index]')) continue
      add(element, null)
    }
    return rows.sort((a, b) => a.index - b.index)
  }
  function referenceState(scope) {
    const refs = scope.references
    const cards = attachments(scope)
    const expanders = [...refs.querySelectorAll('[class*="expand-entry-"],[aria-label="展开素材面板"]')].filter(visible)
    const compactEntries = [...refs.querySelectorAll('[class*="collapsed-more-entry-"]')].filter(visible)
    const media = [...refs.querySelectorAll('img:not(.ProseMirror-separator),video,canvas,[style*="background-image"]')].filter(element => !element.closest('[contenteditable="true"],[aria-hidden="true"]') && !element.closest('[aria-label="参考内容"]'))
    const removeCount = refs.querySelectorAll('[data-native-reference-action="remove"]').length
    let declaredCount = null
    for (const tab of refs.querySelectorAll('[role="tab"]')) {
      const match = /^全部(?:\s*[（(]\s*(\d+)\s*[）)])?$/.exec(tidy(tab.textContent))
      if (match) {
        declaredCount = match[1] === undefined ? null : Number(match[1])
        break
      }
    }
    const collapsed = expanders.length > 0 || compactEntries.length > 0
    const complete = !collapsed && (declaredCount === null || declaredCount === cards.length) && removeCount <= cards.length && (!media.length || cards.length > 0)
    return { cards, expanders, compactEntries, collapsed, complete, declaredCount, mediaCount: media.length, removeCount, emptyVerified: !collapsed && !cards.length && !media.length && !removeCount && (declaredCount === null || declaredCount === 0) }
  }
  function busy(scope) {
    return [...scope.references.querySelectorAll('[aria-busy="true"],[role="progressbar"],[data-state="uploading"],[data-upload-status="uploading"]')].some(visible)
  }
  function uploadError(scope) {
    return [...scope.references.querySelectorAll('[role="alert"],[data-state="error"],[data-upload-status="error"]')].map(element => tidy(element.textContent)).find(text => /失败|错误|出错|不支持|超出/.test(text)) || null
  }
  function scrapeLimits(scope) {
    const total = []
    const image = []
    const add = (kind, limit) => {
      if (Number.isInteger(limit) && limit > 0 && limit <= 10000) (kind === 'image' ? image : total).push(limit)
    }
    const parse = text => {
      for (const match of text.matchAll(/最多\s*(?:可)?\s*(?:添加|上传|支持)?\s*(\d+)\s*(?:个|张|份)?\s*(?:参考)?素材/g)) add('total', Number(match[1]))
      for (const match of text.matchAll(/最多\s*(?:可)?\s*(?:添加|上传|支持)?\s*(\d+)\s*(?:个|张)?\s*(?:参考)?(?:图片|图像|图)/g)) add('image', Number(match[1]))
      for (const match of text.matchAll(/(?:图片|图像|参考图)\s*(?:最多|上限)\s*(?:添加|上传)?\s*(\d+)\s*(?:张|个)?/g)) add('image', Number(match[1]))
    }
    const elements = [scope.root, scope.editor, scope.references, ...scope.root.querySelectorAll('.rich-placeholder-widget,[data-rich-placeholder],[data-placeholder],[aria-placeholder],[title],[aria-description]')]
    for (const element of elements) {
      for (const attribute of ['data-placeholder', 'aria-placeholder', 'title', 'aria-description']) parse(element.getAttribute(attribute) || '')
      if (element.matches?.('.rich-placeholder-widget,[data-rich-placeholder]')) parse(element.textContent || '')
    }
    return {
      siteImageLimit: image.length ? Math.min(...image) : null,
      totalLimit: total.length ? Math.min(...total) : null
    }
  }
  function durationButton(scope) {
    const buttons = [...scope.root.querySelectorAll('button')].filter(element => visible(element) && /^\d+\s*s$/i.test(tidy(element.innerText || element.textContent)))
    if (buttons.length !== 1) throw new StepError('未能唯一确认即梦的视频时长按钮，未清空图词。', 'DURATION_CONTROL_UNKNOWN')
    return buttons[0]
  }
  function durationValue(scope) {
    const match = /^(\d+)\s*s$/i.exec(tidy(durationButton(scope).innerText || durationButton(scope).textContent))
    return Number(match[1])
  }
  function promptAllowed(state, actual) {
    const seen = verify(actual)
    if (state.writeTarget != null) {
      const target = verify(state.writeTarget)
      const before = verify(state.writeBefore || '')
      return !seen || seen === before || seen === target || Boolean(target && target.startsWith(seen))
    }
    if (state.clearing) return seen === verify(state.expectedPrompt) || seen === ''
    return seen === verify(state.expectedPrompt)
  }
  function guard() {
    if (api.stopped) throw new StepError('已停止填入，现有内容保留。', 'PAUSED')
    if (api.interrupted) throw new StepError('检测到当前图词被手动修改，已停止以保留你的内容。', 'USER_INTERRUPTED')
    if (!api.pin) throw new StepError('填写尚未开始。', 'FILL_NOT_STARTED')
    if (location.href !== api.pin.href || !api.pin.root.isConnected || !api.pin.editor.isConnected) throw new StepError('页面或编辑器已变化，已停止。', 'EDITOR_CHANGED')
    if (!api.ownDepth && !promptAllowed(api, readPrompt(api.pin.editor))) throw new StepError('当前提示词与目标不一致，已保留文字，未继续传图。', 'EDITOR_CHANGED')
    const scope = composer()
    if (scope.root !== api.pin.root || scope.editor !== api.pin.editor || contextOf(scope) !== api.pin.context) throw new StepError('当前模型、模式或编辑器已切换，已停止。', 'CONTEXT_CHANGED')
    if (api.expectedDuration != null && durationValue(scope) !== api.expectedDuration) throw new StepError('视频时长已改变，请核对目标 ' + api.expectedDuration + ' 秒。', 'DURATION_CHANGED')
    return scope
  }
  async function waitFor(probe, timeout, message) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      const value = await probe()
      if (value) return value
      await sleep(120)
    }
    throw new StepError(message, 'UI_TIMEOUT')
  }
  function withOwn(fn) {
    api.ownDepth += 1
    try { return fn() } finally { api.ownDepth -= 1 }
  }
  function onManual(event) {
    const current = globalThis.__jimengCodex
    if (!current?.pin || current.ownDepth || !event.isTrusted) return
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement
    const inDuration = Boolean(target?.closest('[class*="duration-panel-"]'))
    if (!current.pin.root.contains(event.target) && !inDuration) return
    if (['paste', 'drop', 'cut', 'compositionstart', 'pointerdown'].includes(event.type)) current.interrupted = true
    if (event.type === 'keydown') {
      const key = event.key || ''
      const shortcut = event.ctrlKey || event.metaKey
      if ((shortcut && key === 'Enter') || current.pin.editor.contains(target) && (['Backspace', 'Delete', 'Enter'].includes(key) || (key.length === 1 && !shortcut && !event.altKey))) current.interrupted = true
    }
    if (event.type === 'input' && !promptAllowed(current, readPrompt(current.pin.editor))) current.interrupted = true
  }
  if (document.documentElement.dataset.jimengCodexListener !== '1') {
    for (const type of ['pointerdown', 'keydown', 'input', 'compositionstart', 'cut', 'drop', 'paste']) document.addEventListener(type, onManual, true)
    document.documentElement.dataset.jimengCodexListener = '1'
  }
  async function expand() {
    let scope = guard()
    let state = referenceState(scope)
    if (!state.collapsed) return scope
    if (!state.expanders.length && state.compactEntries.length) {
      if (state.compactEntries.length !== 1) throw new StepError('无法唯一确认折叠素材入口，请手动展开素材面板后重试。', 'REFERENCE_PANEL_AMBIGUOUS')
      const triggers = [...scope.references.querySelectorAll('[class*="reference-group-hover-trigger-"]')]
      if (triggers.length > 1) throw new StepError('发现多个素材组，请手动展开素材面板后重试。', 'REFERENCE_PANEL_AMBIGUOUS')
      withOwn(() => {
        for (const element of [triggers[0], state.compactEntries[0]].filter(Boolean)) {
          element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
          element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
        }
      })
      await waitFor(() => referenceState(guard()).expanders.length > 0, 2000, '素材仍处于折叠状态，请手动展开素材面板后重试。')
      state = referenceState(guard())
    }
    const targets = state.expanders.filter(element => !state.expanders.some(other => other !== element && other.contains(element)))
    if (targets.length !== 1) throw new StepError('无法唯一确认展开素材面板入口，未修改当前图词。', 'REFERENCE_PANEL_AMBIGUOUS')
    withOwn(() => targets[0].click())
    await waitFor(() => !referenceState(guard()).collapsed, 5000, '素材面板没有确认展开，已停止。')
    return guard()
  }
  function describe(scope) {
    const prompt = readPrompt(scope.editor)
    const state = referenceState(scope)
    let duration = null
    try { duration = durationValue(scope) } catch { duration = null }
    return {
      ok: true,
      editorFound: true,
      url: location.href,
      model: tidy(scope.model.innerText || scope.model.textContent),
      mode: tidy(scope.mode.innerText || scope.mode.textContent),
      prompt,
      promptLength: prompt.length,
      duration,
      attachmentCount: state.cards.length,
      referencesCollapsed: state.collapsed,
      referencesEmpty: state.emptyVerified,
      complete: state.complete,
      loaded: state.cards.every(card => card.source && card.loaded),
      busy: busy(scope),
      uploadError: uploadError(scope),
      ...scrapeLimits(scope)
    }
  }

  api.inspect = () => {
    try { return describe(composer()) } catch (error) {
      return { ok: true, editorFound: false, url: location.href, message: error.message, code: error.code || 'EDITOR_NOT_FOUND' }
    }
  }
  api.begin = () => {
    const scope = composer()
    api.stopped = false
    api.interrupted = false
    api.clearing = false
    api.writeTarget = null
    api.expectedDuration = null
    api.expectedPrompt = readPrompt(scope.editor)
    api.pin = { href: location.href, root: scope.root, editor: scope.editor, context: contextOf(scope) }
    return describe(scope)
  }
  api.stop = () => {
    api.stopped = true
    api.pin = null
    return { ok: true, stopped: true }
  }
  api.inventory = expected => {
    try {
      const scope = guard()
      const view = describe(scope)
      return { ...view, promptMatches: expected == null || verify(view.prompt) === verify(expected) }
    } catch (error) {
      return { ok: false, code: error.code || 'FILL_FAILED', message: error.message }
    }
  }
  api.setDuration = async seconds => {
    if (!Number.isSafeInteger(seconds) || seconds < 1) throw new StepError('推荐秒数必须是正整数，未修改当前图词。', 'INVALID_DURATION')
    let scope = guard()
    if (durationValue(scope) === seconds) {
      api.expectedDuration = seconds
      return { ok: true, seconds, confirmed: true }
    }
    const button = durationButton(scope)
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') throw new StepError('当前视频时长不可修改，未清空图词。', 'DURATION_DISABLED')
    const findInput = () => {
      const panels = [...document.querySelectorAll('[class*="duration-panel-"]')].filter(element => visible(element) && /选择视频生成时长/.test(tidy(element.innerText || element.textContent)))
      if (panels.length > 1) throw new StepError('发现多个时长设置面板，未修改图词。', 'DURATION_CONTROL_AMBIGUOUS')
      const inputs = panels.flatMap(element => [...element.querySelectorAll('input[role="spinbutton"][aria-valuemin][aria-valuemax]')].filter(visible))
      if (inputs.length > 1) throw new StepError('发现多个时长输入框，未修改图词。', 'DURATION_CONTROL_AMBIGUOUS')
      return inputs[0] || null
    }
    if (!findInput()) withOwn(() => button.click())
    const input = await waitFor(() => findInput(), 5000, '未找到即梦时长输入框，未清空图词。')
    const min = Number(input.getAttribute('aria-valuemin'))
    const max = Number(input.getAttribute('aria-valuemax'))
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) throw new StepError('无法确认当前模型支持的时长范围，未清空图词。', 'DURATION_RANGE_UNKNOWN')
    if (seconds < min || seconds > max) throw new StepError('推荐 ' + seconds + ' 秒不在当前模型支持的 ' + min + '–' + max + ' 秒范围内，未清空图词。', 'DURATION_UNSUPPORTED')
    if (input.disabled || input.readOnly || input.getAttribute('aria-disabled') === 'true') throw new StepError('当前时长输入框不可修改，未清空图词。', 'DURATION_DISABLED')
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (!descriptor?.set) throw new StepError('当前页面无法安全设置时长，未清空图词。', 'DURATION_CONTROL_UNKNOWN')
    withOwn(() => {
      input.focus()
      descriptor.set.call(input, String(seconds))
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }))
    })
    await waitFor(() => durationValue(guard()) === seconds, 5000, '即梦没有确认 ' + seconds + ' 秒，请手动核对时长。')
    api.expectedDuration = seconds
    return { ok: true, seconds, confirmed: true }
  }
  api.writePrompt = async text => {
    const scope = guard()
    const target = normalize(text)
    api.writeBefore = readPrompt(scope.editor)
    api.writeTarget = target
    try {
      withOwn(() => {
        scope.editor.focus({ preventScroll: true })
        const range = document.createRange()
        range.selectNodeContents(scope.editor)
        const selection = window.getSelection()
        selection.removeAllRanges()
        selection.addRange(range)
        const accepted = document.execCommand(target ? 'insertText' : 'delete', false, target || null)
        if (!accepted) throw new StepError('浏览器没有接受编辑事件，未强行改写页面。', 'INPUT_REJECTED')
      })
      await waitFor(() => verify(readPrompt(guard().editor)) === verify(target), 6000, '提示词尚未完整回显，已保留文字，未上传图片。')
      api.expectedPrompt = target
      return { ok: true, length: verify(target).length }
    } finally {
      api.writeTarget = null
      api.writeBefore = null
    }
  }
  api.clearComposer = async () => {
    api.clearing = true
    try {
      await expand()
      const scope = guard()
      const state = referenceState(scope)
      const candidates = [...scope.root.querySelectorAll('button,[role="button"]')].filter(element => visible(element) && [tidy(element.getAttribute('aria-label')), tidy(element.textContent)].some(label => /^清空(?:全部)?素材$/.test(label)))
      const buttons = candidates.filter(element => !candidates.some(other => other !== element && other.contains(element)))
      if (buttons.length > 1) throw new StepError('当前输入框有多个清空素材按钮，尚未清空。', 'CLEAR_CONTROL_AMBIGUOUS')
      if (buttons.length === 1 && !(state.emptyVerified && (buttons[0].disabled || buttons[0].getAttribute('aria-disabled') === 'true'))) {
        const button = buttons[0]
        if (button.disabled || button.getAttribute('aria-disabled') === 'true') throw new StepError('当前清空素材按钮暂不可用，未清空文字。', 'CLEAR_CONTROL_DISABLED')
        withOwn(() => button.click())
        let emptySince = null
        await waitFor(() => {
          const current = referenceState(guard())
          if (!current.emptyVerified) {
            emptySince = null
            return false
          }
          if (emptySince === null) emptySince = Date.now()
          return Date.now() - emptySince >= 500
        }, 8000, '清空参考素材未得到页面确认，已停止；提示词尚未替换。')
      } else {
        for (let safety = 0; safety < 60; safety += 1) {
          const current = referenceState(guard())
          if (current.emptyVerified) break
          const cards = [...current.cards].sort((a, b) => a.index - b.index)
          const remove = cards.at(-1)?.remove
          if (!remove || remove.disabled || remove.getAttribute('aria-disabled') === 'true') throw new StepError('当前输入框缺少可用的素材删除控件，已保留文字。', 'REMOVE_CONTROL_MISSING')
          const before = cards.length
          withOwn(() => remove.click())
          await waitFor(() => referenceState(guard()).cards.length < before, 8000, '删除参考素材未得到页面确认，已停止；提示词尚未替换。')
        }
      }
      if (!referenceState(guard()).emptyVerified) throw new StepError('当前素材尚未清空，未替换文字或填入新图词。', 'REFERENCES_NOT_EMPTY')
      if (readPrompt(guard().editor)) await api.writePrompt('')
      api.expectedPrompt = ''
      await waitFor(() => readPrompt(guard().editor) === '', 4000, '清空原提示词未得到页面确认，已停止。')
      return { ok: true, cleared: true }
    } finally {
      api.clearing = false
    }
  }
  api.assignFiles = async files => {
    if (!Array.isArray(files) || !files.length) return { ok: false, dispatched: false, code: 'INVALID_UPLOAD_PAYLOAD', message: '没有可上传的参考图。' }
    await expand()
    if (!referenceState(guard()).emptyVerified) return { ok: false, dispatched: false, code: 'REFERENCES_NOT_EMPTY', message: '参考区仍有其他图片，未添加。' }
    const built = []
    for (const item of files) {
      if (!item?.name || /[\\/\u0000-\u001f]/.test(item.name) || typeof item.base64 !== 'string' || !item.sha256) {
        return { ok: false, dispatched: false, code: 'INVALID_UPLOAD_PAYLOAD', message: '参考图数据无效。' }
      }
      const binary = atob(item.base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      const digest = await crypto.subtle.digest('SHA-256', bytes)
      const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== item.sha256 || bytes.length !== item.size) return { ok: false, dispatched: false, code: 'UPLOAD_SHA_MISMATCH', message: '参考图文件内容指纹不一致。' }
      built.push(new File([bytes], item.name, { type: item.type || 'image/png' }))
    }
    const transfer = new DataTransfer()
    for (const file of built) transfer.items.add(file)
    const scope = guard()
    const upload = only([...scope.root.querySelectorAll('button[aria-label="参考内容"],[role="button"][aria-label="参考内容"]')].filter(visible), '没有确认唯一的参考内容上传按钮')
    const prototype = HTMLInputElement.prototype
    const nativeClick = prototype.click
    let captured = null
    let captureProblem = null
    const accepts = (input, file) => {
      const list = String(input.accept || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
      if (!list.length) return true
      const type = String(file.type || '').toLowerCase()
      const name = file.name.toLowerCase()
      return list.some(value => value === '*' || value === '*/*' || (value === 'image/*' && type.startsWith('image/')) || value === type || (value.startsWith('.') && name.endsWith(value)))
    }
    Object.defineProperty(prototype, 'click', {
      configurable: true,
      writable: true,
      value(...args) {
        if (this?.type !== 'file') return nativeClick.apply(this, args)
        if (captured) {
          captureProblem = { code: 'UPLOAD_INPUT_AMBIGUOUS', message: '一次上传触发了多个文件输入框，未继续。' }
          return undefined
        }
        captured = this
        try {
          if (!this.multiple && built.length > 1) throw new StepError('文件控件不支持这批参考图。', 'UPLOAD_MULTIPLE_UNSUPPORTED')
          if (built.some(file => !accepts(this, file))) throw new StepError('文件控件不接受本批图片格式。', 'UPLOAD_ACCEPT_MISMATCH')
          this.files = transfer.files
        } catch (error) {
          captureProblem = { code: error.code || 'UPLOAD_BRIDGE_FAILED', message: error.message }
        }
        return undefined
      }
    })
    try {
      withOwn(() => upload.click())
    } finally {
      Object.defineProperty(prototype, 'click', { configurable: true, writable: true, value: nativeClick })
    }
    if (captureProblem) return { ok: false, dispatched: false, ...captureProblem }
    if (captured) {
      captured.dispatchEvent(new Event('input', { bubbles: true }))
      captured.dispatchEvent(new Event('change', { bubbles: true }))
      return { ok: true, dispatched: true, method: 'file-input', count: built.length }
    }
    scope.root.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    return { ok: true, dispatched: true, method: 'drop', count: built.length }
  }
  api.clickGenerate = () => {
    const scope = composer()
    const labelled = [...scope.root.querySelectorAll('[data-testid="dreamina.generator.submit"],button[aria-label="生成"],[role="button"][aria-label="生成"]')].filter(visible)
    const buttons = labelled.length ? labelled : [...scope.root.querySelectorAll('button,[role="button"]')].filter(element => visible(element) && tidy(element.innerText || element.textContent) === '生成')
    const button = only(buttons, '没有确认唯一的生成按钮')
    if (button.disabled || button.getAttribute('aria-disabled') === 'true') throw new StepError('生成按钮当前不可用。', 'GENERATE_DISABLED')
    button.click()
    return { ok: true, clicked: true }
  }

  globalThis.__jimengCodex = api
  return { ok: true, installed: true, build: BUILD }
}
