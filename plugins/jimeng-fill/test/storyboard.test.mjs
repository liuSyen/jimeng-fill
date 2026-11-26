import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import { readDurationTable } from '../src/durations.mjs'
import { matchStoryboard, parseStoryboard } from '../src/storyboard.mjs'

const STORY = `分镜 1-1
【角色】林晚
【场景】海岛船坞
【道具】无
林晚站在船坞边。

分镜 1-2
【角色】林晚、阿海
【场景】海岛船坞【夜】
【道具】扳手
两人在夜里修船。
`

test('标题里的秒数能拆条并抽出草稿时长', () => {
  const parsed = parseStoryboard(`## 剧情1: 分镜1-1（20秒）
【角色】林晚
【场景】海岛船坞
【道具】无
林晚站在船坞边。

## 剧情1: 分镜1-2(8s)
【角色】林晚
【场景】海岛船坞
【道具】无
林晚转身离开。
`)
  assert.deepEqual(parsed.tasks.map(task => task.id), ['1-1', '1-2'])
  assert.equal(parsed.tasks[0].suggestedDuration, 20)
  assert.equal(parsed.tasks[1].suggestedDuration, 8)
})

test('分镜标题和资产头按插件规则拆开', () => {
  const parsed = parseStoryboard(STORY)
  assert.deepEqual(parsed.tasks.map(task => task.id), ['1-1', '1-2'])
  assert.equal(parsed.tasks[0].refs.some(ref => ref.kind === '道具' && ref.name === '无'), true)
  const matched = matchStoryboard(parsed.tasks, [
    { id: '林晚.png', name: '林晚.png' },
    { id: '阿海.png', name: '阿海.png' },
    { id: '海岛船坞.png', name: '海岛船坞.png' },
    { id: '海岛船坞【夜】.png', name: '海岛船坞【夜】.png' },
    { id: '扳手.png', name: '扳手.png' }
  ], {})
  assert.equal(matched.tasks[0].ready, true)
  assert.equal(matched.tasks[0].matches.find(match => match.kind === '道具').status, 'ignored')
  assert.equal(matched.tasks[1].ready, true)
  assert.equal(matched.summary.ready, 2)
})

test('同名参考图标成歧义，不擅自挑一张', () => {
  const parsed = parseStoryboard(STORY)
  const matched = matchStoryboard(parsed.tasks, [
    { id: 'a/林晚.png', name: '林晚.png' },
    { id: 'b/林晚.png', name: '林晚.png' },
    { id: '海岛船坞.png', name: '海岛船坞.png' }
  ], {})
  const role = matched.tasks[0].matches.find(match => match.name === '林晚')
  assert.equal(role.status, 'ambiguous')
  assert.equal(matched.tasks[0].ready, false)
})

test('xlsx 秒数表读取分镜和推荐时长', async () => {
  const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="时长" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
  const shared = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>分镜</t></si><si><t>推荐时长（秒）</t></si><si><t>1-1</t></si><si><t>5</t></si>
</sst>`
  const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
    <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
  </sheetData>
</worksheet>`
  const bytes = zipSync({
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(rels),
    'xl/sharedStrings.xml': strToU8(shared),
    'xl/worksheets/sheet1.xml': strToU8(sheet)
  })
  const dir = await mkdtemp(join(tmpdir(), 'jimeng-duration-'))
  const file = join(dir, '时长.xlsx')
  await writeFile(file, bytes)
  const table = await readDurationTable(file)
  assert.deepEqual(table.durations, { '1-1': 5 })
})
