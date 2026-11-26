import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { CodedError } from '../src/errors.mjs'
import { assignReference, confirmMatches, currentAsk, fillJimeng, generateJimeng, listShots, loadAssets, loadDurations, loadStoryboard, showShot } from '../src/tools.mjs'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const STORY = `分镜 1-1
【角色】林晚
【场景】海岛船坞
【道具】无
林晚站在船坞边。
`

test('分镜、秒数表和参考图目录不能一次传入', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jimeng-step-'))
  process.env.JIMENG_STATE_PATH = join(dir, 'state.json')
  await assert.rejects(
    () => loadStoryboard({ storyboardPath: join(dir, '分镜.txt'), referencesDir: join(dir, 'refs'), durationsPath: join(dir, '秒数.json') }),
    error => error instanceof CodedError && error.code === 'STEP_BY_STEP'
  )
  await assert.rejects(() => loadDurations({ skip: true }), error => error.code === 'NEED_ANSWER')
})

test('缺图时先问这一条怎么配，填入和生成都不会打开浏览器', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jimeng-batch-'))
  process.env.JIMENG_STATE_PATH = join(dir, 'state.json')
  const refs = join(dir, 'refs')
  await mkdir(refs)
  await writeFile(join(dir, '分镜.txt'), STORY)
  await writeFile(join(dir, '秒数.json'), JSON.stringify({ '1-1': 5 }))
  await writeFile(join(refs, '海岛船坞.png'), PNG)
  const storyboard = await loadStoryboard({ storyboardPath: join(dir, '分镜.txt') })
  assert.equal(storyboard.step, 'durations')
  assert.match(storyboard.ask, /秒数/)
  await assert.rejects(() => loadAssets({ referencesDir: refs }), error => error.code === 'NEED_ANSWER')
  const durations = await loadDurations({ durationsPath: join(dir, '秒数.json') })
  assert.equal(durations.step, 'assets')
  assert.equal(durations.missingDuration.length, 0)
  const assets = await loadAssets({ referencesDir: refs })
  assert.equal(assets.step, 'matching')
  assert.equal(assets.ref, '角色:林晚')
  assert.match(assets.ask, /林晚/)
  await assert.rejects(() => fillJimeng({ shotId: '1-1' }), error => error instanceof CodedError && error.code === 'NEED_ANSWER' && /林晚/.test(error.message))
  await assert.rejects(() => generateJimeng({ shotId: '1-1', confirm: '确认生成' }), error => error.code === 'NEED_ANSWER')
  const skipped = await assignReference({ ref: '角色:林晚', skip: true })
  assert.equal(skipped.step, 'confirm_matches')
  const confirmed = await confirmMatches({ confirm: '确认匹配' })
  assert.equal(confirmed.step, 'ready')
})

test('同名图要等用户指定路径，确认匹配后才算可填', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jimeng-assign-'))
  process.env.JIMENG_STATE_PATH = join(dir, 'state.json')
  const refs = join(dir, 'refs')
  await mkdir(join(refs, 'a'), { recursive: true })
  await mkdir(join(refs, 'b'), { recursive: true })
  await writeFile(join(refs, 'a', '林晚.png'), PNG)
  await writeFile(join(refs, 'b', '林晚.png'), PNG)
  await writeFile(join(refs, '海岛船坞.png'), PNG)
  const storyboard = await loadStoryboard({ text: STORY })
  assert.equal(storyboard.step, 'durations')
  await loadDurations({ skip: true })
  const assets = await loadAssets({ referencesDir: refs })
  assert.equal(assets.step, 'matching')
  assert.equal(assets.status, 'ambiguous')
  assert.equal(assets.choices.length, 2)
  await assert.rejects(() => assignReference({ ref: '角色:林晚', asset: '林晚.png' }), error => error.code === 'OVERRIDE_AMBIGUOUS')
  const assigned = await assignReference({ ref: '人物:林晚', asset: 'a/林晚.png' })
  assert.equal(assigned.assetId, 'a/林晚.png')
  assert.equal(assigned.step, 'confirm_matches')
  await assert.rejects(() => fillJimeng({ shotId: '1-1' }), error => error.code === 'NEED_ANSWER')
  const confirmed = await confirmMatches({ confirm: '确认匹配' })
  assert.equal(confirmed.step, 'ready')
  const shot = await showShot('1-1')
  assert.equal(shot.ready, true)
  assert.equal(shot.prompt.includes('林晚站在船坞边'), true)
  const listed = await listShots({ readyOnly: true })
  assert.equal(listed.shown, 1)
  assert.equal((await currentAsk()).step, 'ready')
})
