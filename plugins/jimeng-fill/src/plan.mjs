import { coded } from './errors.mjs'

// 与插件 content.js 的回读规则一致：忽略占位换行和结尾空白。
export function verifyText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
    .replace(/\u00a0/g, ' ')
    .replace(/^[\n]+|[ \t\n]+$/g, '')
    .replace(/\n+/g, '\n')
}

export function promptsEqual(left, right) {
  return verifyText(left) === verifyText(right)
}

// 插件里写死的模型策略：页面上读到的更低上限优先。
export function resolveImageLimit({ model = '', mode = '', siteImageLimit = null, totalLimit = null, override = null } = {}) {
  if (override !== null && override !== undefined && (!Number.isInteger(override) || override < 1 || override > 100)) {
    throw coded('图片数量上限应为 1 到 100 的整数。', 'INVALID_IMAGE_LIMIT')
  }
  let policy = null
  if (/seedance/i.test(model) && /全能参考/.test(mode)) {
    if (/2\s*\.\s*5/.test(model)) policy = 50
    else if (/2\s*\.\s*0/.test(model)) policy = 9
  }
  let imageLimit = null
  let source = 'unknown-image-limit'
  if (Number.isInteger(siteImageLimit) && siteImageLimit > 0) {
    imageLimit = override == null ? siteImageLimit : Math.min(siteImageLimit, override)
    source = override != null && override < siteImageLimit ? 'user-confirmed-image-limit' : 'current-ui-image-limit'
  } else if (override != null) {
    imageLimit = override
    source = 'user-confirmed-image-limit'
  } else if (policy !== null) {
    imageLimit = policy
    source = 'model-image-policy'
  }
  const capped = imageLimit === null ? null : Math.min(imageLimit, Number.isInteger(totalLimit) ? totalLimit : Infinity)
  return {
    limit: capped === Infinity ? imageLimit : capped,
    source,
    policyImageLimit: policy,
    siteImageLimit: Number.isInteger(siteImageLimit) ? siteImageLimit : null,
    totalLimit: Number.isInteger(totalLimit) ? totalLimit : null
  }
}

// 人物、场景必须进上传列表；道具在上限内按原顺序补上。
export function referencePlan(task, capacity) {
  const limit = typeof capacity === 'number' ? capacity : capacity?.limit
  const byId = new Map()
  for (const [index, match] of (task.matches || []).entries()) {
    if (match.kind !== '道具' && !match.optional && !['ignored', 'exact', 'normalized', 'manual'].includes(match.status)) {
      throw coded('人物或场景缺图或存在歧义，未修改即梦页面。', 'ASSETS_MISSING')
    }
    if (match.assetId === undefined || !['exact', 'normalized', 'manual'].includes(match.status)) continue
    const id = String(match.assetId)
    const optional = match.kind === '道具'
    const priority = ['角色', '人物'].includes(match.kind) ? 0 : match.kind === '场景' ? 1 : optional ? 3 : 2
    const evidence = (task.assetEvidence || []).find(item => String(item.id) === id)
    const row = { id, optional, priority, index, name: evidence?.name || match.name || id }
    const old = byId.get(id)
    if (!old || (old.optional && !optional)) byId.set(id, row)
  }
  const rows = [...byId.values()].sort((a, b) => a.priority - b.priority || a.index - b.index)
  const required = rows.filter(row => !row.optional)
  const optional = rows.filter(row => row.optional)
  if (rows.length && (!Number.isInteger(limit) || limit < 1)) {
    throw coded('未读取到当前模型和模式的参考图上限。请先打开视频编辑器，或在填入时写明 imageLimit。', 'REFERENCE_LIMIT_UNKNOWN')
  }
  if (required.length > limit) {
    throw coded(`当前最多 ${limit} 个参考素材，人物与场景已有 ${required.length} 张；未修改图词。`, 'REFERENCE_LIMIT_REQUIRED')
  }
  const room = Number.isInteger(limit) ? Math.max(0, limit - required.length) : 0
  const selected = [...required, ...optional.slice(0, room)]
  const omitted = optional.slice(room)
  return {
    limit: Number.isInteger(limit) ? limit : null,
    limitSource: typeof capacity === 'object' ? capacity?.source ?? null : null,
    assetIds: selected.map(row => row.id),
    selectedNames: selected.map(row => row.name),
    omittedOptionalNames: omitted.map(row => row.name),
    requiredCount: required.length,
    selectedCount: selected.length
  }
}
