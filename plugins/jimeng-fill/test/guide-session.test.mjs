import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { formatBoardPreview, runGuide } from '../src/guide.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const STORY = `## 剧情1: 分镜1-1（20秒）
【角色】林晚
【场景】海岛船坞
【道具】无
林晚站在船坞边看海。

## 剧情1: 分镜1-2（15秒）
【角色】林晚
【场景】甲板
【道具】无
林晚转身走向舱门。
`

test('会话向导用表单单选确认，不弹系统窗、不打开浏览器', async () => {
  const guide = await import('node:fs/promises').then(fs => fs.readFile(join(root, 'src/guide.mjs'), 'utf8'))
  assert.equal(guide.includes("spawn('open'"), false)
  assert.equal(guide.includes('startWizard'), false)
  assert.match(guide, /chooseFile/)
  assert.match(guide, /选择分镜文档/)
  assert.equal(guide.includes('chooseFromList'), false)
  assert.equal(guide.includes('textDialog'), false)
  assert.equal(guide.includes("mode: 'url'"), false)
  assert.match(guide, /mode: 'form'/)
  assert.match(guide, /oneOf/)
  assert.match(guide, /askChoice/)
  assert.match(guide, /formatBoardPreview/)
})

test('表单向导可连续点选并显示读入内容', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jimeng-form-'))
  process.env.JIMENG_STATE_PATH = join(dir, 'state.json')
  const answers = [
    { action: 'accept', content: { choice: 'paste' } },
    { action: 'accept', content: { text: STORY } },
    { action: 'accept', content: { choice: 'use_title' } },
    { action: 'accept', content: { choice: 'cancel' } }
  ]
  const mcp = {
    server: {
      elicitInput: async ({ mode, message, requestedSchema }) => {
        assert.equal(mode, 'form')
        assert.ok(requestedSchema?.properties)
        if (answers.length === 2) assert.match(String(message), /1-1|林晚|已读入|分镜/)
        return answers.shift()
      }
    }
  }
  const result = await runGuide(mcp, {})
  assert.equal(result.mode, 'form')
  assert.equal(result.cancelled, true)
})

test('读入后 preview 含分镜正文，选项在对话框里选', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jimeng-guide-'))
  process.env.JIMENG_STATE_PATH = join(dir, 'state.json')
  const file = join(dir, '分镜.txt')
  await writeFile(file, STORY, 'utf8')

  const loaded = await runGuide(null, { path: file })
  assert.equal(loaded.mode, 'chat')
  assert.equal(loaded.awaiting, true)
  assert.equal(loaded.step, 'durations')
  assert.match(loaded.preview, /1-1/)
  assert.match(loaded.preview, /林晚站在船坞边看海/)
  assert.match(loaded.preview, /1-2/)
  assert.match(loaded.message, /使用标题抽出的/)
  assert.ok(loaded.options.some(item => item.value === 'use_title'))

  const next = await runGuide(null, { reply: '使用标题抽出的 2 条秒数' })
  assert.equal(next.step, 'assets')
  assert.match(next.preview, /已读入/)
})

test('formatBoardPreview 列出秒数与摘要', () => {
  const text = formatBoardPreview({
    sourceName: '分镜.txt',
    extractedDurations: { '1-1': 20 },
    shots: [{
      id: '1-1',
      title: '分镜1-1',
      suggestedDuration: 20,
      prompt: '林晚站在船坞边。',
      refs: [{ kind: '角色', name: '林晚' }, { kind: '场景', name: '海岛船坞' }]
    }]
  })
  assert.match(text, /分镜\.txt/)
  assert.match(text, /20秒/)
  assert.match(text, /林晚/)
  assert.match(text, /林晚站在船坞边/)
})

test('JIMENG_UI=workbench 时不走会话步进', async () => {
  const previous = process.env.JIMENG_UI
  process.env.JIMENG_UI = 'workbench'
  try {
    const result = await runGuide(null)
    assert.equal(result.embed, 'workbench')
  } finally {
    if (previous == null) delete process.env.JIMENG_UI
    else process.env.JIMENG_UI = previous
  }
})
