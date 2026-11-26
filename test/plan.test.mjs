import assert from 'node:assert/strict'
import test from 'node:test'
import { referencePlan, resolveImageLimit } from '../src/plan.mjs'
import { installJimengPageApi } from '../src/page-api.mjs'

test('参考图按人物、场景、道具排序，道具超出上限就省略', () => {
  const task = {
    matches: [
      { kind: '道具', name: '扳手', status: 'exact', assetId: 'c' },
      { kind: '场景', name: '船坞', status: 'exact', assetId: 'b' },
      { kind: '角色', name: '林晚', status: 'exact', assetId: 'a' }
    ]
  }
  const plan = referencePlan(task, { limit: 2, source: 'test' })
  assert.deepEqual(plan.assetIds, ['a', 'b'])
  assert.deepEqual(plan.omittedOptionalNames, ['扳手'])
})

test('人物缺图时不生成上传计划', () => {
  assert.throws(() => referencePlan({
    matches: [{ kind: '角色', name: '林晚', status: 'missing' }]
  }, { limit: 9 }), error => error.code === 'ASSETS_MISSING')
})

test('Seedance 全能参考使用插件里的张数策略，页面上限更低时以页面为准', () => {
  assert.equal(resolveImageLimit({ model: 'Seedance 2.5', mode: '全能参考' }).limit, 50)
  assert.equal(resolveImageLimit({ model: 'Seedance 2.0', mode: '全能参考' }).limit, 9)
  assert.equal(resolveImageLimit({ model: 'Seedance 2.5', mode: '全能参考', siteImageLimit: 12 }).limit, 12)
  assert.equal(resolveImageLimit({ model: '其他模型', mode: '首尾帧' }).limit, null)
})

test('页面脚本保留即梦编辑器选择器', () => {
  const source = installJimengPageApi.toString()
  for (const marker of ['dreamina.generator', 'aria-label="提示词"', 'data-content-generator-references', '参考内容', 'dreamina.generator.submit']) {
    assert.ok(source.includes(marker), marker)
  }
})
