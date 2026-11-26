import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import * as fflate from 'fflate'
import { coded } from './errors.mjs'

const require = createRequire(import.meta.url)
const durationsApi = require('../vendor/durations.cjs')

class SafeDOMParser {
  parseFromString(xml, type) {
    try {
      return new DOMParser().parseFromString(xml, type)
    } catch {
      return new DOMParser().parseFromString('<parsererror/>', 'text/xml')
    }
  }
}

export function normalizeDurationMap(input, name = '会话编辑') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw coded('秒数 JSON 应该是 { "1-1": 5 } 这种对象。', 'DURATION_FILE')
  }
  const durations = {}
  const warnings = []
  for (const [key, value] of Object.entries(input)) {
    if (value === '' || value == null) continue
    const id = durationsApi.normalizeId(key)
    if (!id) throw coded(`分镜编号无效：${key}。请使用 1-1 这样的格式。`, 'DURATION_INVALID')
    const seconds = durationsApi.number(value)
    if (seconds === null) throw coded(`分镜 ${id} 的推荐时长无效，请填写大于 0 且不超过 600 的整数秒。`, 'DURATION_INVALID')
    if (Object.hasOwn(durations, id)) throw coded(`分镜 ${id} 在时长表中重复。`, 'DURATION_DUPLICATE')
    durations[id] = seconds
  }
  if (!Object.keys(durations).length) throw coded('秒数表里没有可用的分镜。', 'DURATION_EMPTY')
  return { name, durations, count: Object.keys(durations).length, warnings, sheet: null }
}

function normalizeTable(input, name) {
  return normalizeDurationMap(input, name)
}

export function extractedDurationsFromTasks(tasks) {
  const durations = {}
  for (const task of tasks || []) {
    if (!task?.id) continue
    const seconds = durationsApi.number(task.suggestedDuration)
    if (seconds === null) continue
    durations[task.id] = seconds
  }
  return durations
}

export async function readDurationTable(filePath) {
  const name = basename(filePath)
  if (/\.json$/i.test(name)) {
    let parsed
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'))
    } catch {
      throw coded('秒数 JSON 无法解析。', 'DURATION_FILE')
    }
    return normalizeTable(parsed.durations && typeof parsed.durations === 'object' ? parsed.durations : parsed, name)
  }
  if (!/\.xlsx$/i.test(name)) throw coded('秒数表请使用 .xlsx 或 .json。', 'DURATION_FILE')
  const bytes = await readFile(filePath)
  globalThis.DOMParser = SafeDOMParser
  globalThis.fflate = fflate
  const file = {
    name,
    size: bytes.length,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }
  }
  try {
    const result = await durationsApi.readDurationFile(file)
    return {
      name: result.name,
      durations: result.durations,
      count: result.count,
      warnings: result.warnings || [],
      sheet: result.sheet || null
    }
  } catch (error) {
    if (error?.code && error.code !== 'DURATION_FILE' && error instanceof Error && error.name === 'CodedError') throw error
    if (error instanceof Error && error.message) throw coded(error.message, 'DURATION_FILE')
    throw coded('无法读取秒数表。', 'DURATION_FILE')
  }
}

export function durationFor(table, shotId) {
  if (!table) return null
  if (!Object.hasOwn(table, shotId)) {
    throw coded(`秒数表缺少分镜 ${shotId} 的推荐时长。`, 'DURATION_MISSING')
  }
  const seconds = table[shotId]
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) {
    throw coded(`分镜 ${shotId} 的推荐时长无效。`, 'DURATION_INVALID')
  }
  return seconds
}
