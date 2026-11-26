import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { startWizard, wizardPage } from '../src/wizard.mjs'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const STORY = `分镜 1-1
【角色】林晚
【场景】海岛船坞
【道具】无
林晚站在船坞边。
`

const STORY_WITH_DURATION = `## 剧情1: 分镜1-1（20秒）
【角色】林晚
【场景】海岛船坞
【道具】无
林晚站在船坞边。
`

async function json(url, options) {
  const response = await fetch(url, options)
  const body = await response.json()
  return { status: response.status, body }
}

test('向导页先选文件，选中后才能下一步，逐条可改可补', async () => {
  const page = wizardPage()
  assert.match(page, /下一步/)
  assert.match(page, /选择分镜文档/)
  assert.match(page, /让 Codex 重新生成补充/)
  assert.match(page, /从分镜标题抽出的秒数/)
  assert.equal(page.includes('/\\.(png|jpe?g|webp|gif|bmp|avif|tiff?|heic)$/i'), true)

  const dir = await mkdtemp(join(tmpdir(), 'jimeng-wizard-'))
  process.env.JIMENG_STATE_PATH = join(dir, 'state.json')
  const session = await startWizard({ port: 0 })
  try {
    const home = await fetch(session.url)
    assert.equal(home.status, 200)
    assert.match(await home.text(), /下一步/)

    const loaded = await json(new URL('/api/storyboard', session.url), {
      method: 'POST',
      headers: { 'x-filename': encodeURIComponent('分镜.txt') },
      body: STORY
    })
    assert.equal(loaded.status, 200)
    assert.equal(loaded.body.step, 'durations')

    const skipped = await json(new URL('/api/durations', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skip: true })
    })
    assert.equal(skipped.body.step, 'assets')

    const uploaded = await json(new URL('/api/asset', session.url), {
      method: 'POST',
      headers: { 'x-path': encodeURIComponent('海岛船坞.png') },
      body: PNG
    })
    assert.equal(uploaded.status, 200)
    const assets = await json(new URL('/api/assets/done', session.url), { method: 'POST' })
    assert.equal(assets.body.step, 'matching')
    const board = await json(new URL('/api/board', session.url))
    const missing = board.body.shots[0].refs.find(ref => ref.name === '林晚')
    assert.equal(missing.status, 'missing')

    const assigned = await json(new URL('/api/assign', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref: '角色:林晚', skip: true })
    })
    assert.equal(assigned.body.step, 'confirm_matches')

    const rewritten = await json(new URL('/api/prompt', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shotId: '1-1', prompt: '分镜 1-1\n【角色】林晚\n林晚转身离开船坞。' })
    })
    assert.equal(rewritten.status, 200)
    assert.match(rewritten.body.shots[0].prompt, /转身离开船坞/)

    const model = await json(new URL('/api/regenerate', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ shotId: '1-1' })
    })
    assert.equal(model.status, 400)
    assert.equal(model.body.code, 'NEED_MODEL')

    const done = await json(new URL('/api/done', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filled: [] })
    })
    assert.equal(done.body.ok, true)
    assert.deepEqual(session.outcome(), { filled: [], completed: true })
  } finally {
    await session.stop()
  }
})

test('标题抽秒数后可在会话里改并提交', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jimeng-wizard-dur-'))
  process.env.JIMENG_STATE_PATH = join(dir, 'state.json')
  const session = await startWizard({ port: 0 })
  try {
    const loaded = await json(new URL('/api/storyboard', session.url), {
      method: 'POST',
      headers: { 'x-filename': encodeURIComponent('分镜.txt') },
      body: STORY_WITH_DURATION
    })
    assert.equal(loaded.body.step, 'durations')
    assert.equal(loaded.body.extractedDurations['1-1'], 20)

    const board = await json(new URL('/api/board', session.url))
    assert.equal(board.body.shots[0].duration, 20)

    const applied = await json(new URL('/api/durations', session.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ durations: { '1-1': 12 } })
    })
    assert.equal(applied.status, 200)
    assert.equal(applied.body.step, 'assets')
    assert.equal(applied.body.durationCount, 1)

    const after = await json(new URL('/api/board', session.url))
    assert.equal(after.body.shots[0].duration, 12)
    assert.equal(after.body.durationsChosen, true)
  } finally {
    await session.stop()
  }
})
