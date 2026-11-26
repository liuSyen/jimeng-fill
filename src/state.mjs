import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { coded } from './errors.mjs'

export function stateFile() {
  return process.env.JIMENG_STATE_PATH || join(homedir(), '.codex', 'jimeng-fill', 'state.json')
}

export function emptyState() {
  return {
    schemaVersion: 1,
    sourceName: null,
    tasks: [],
    assets: [],
    overrides: {},
    warnings: [],
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
}

export async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(stateFile(), 'utf8'))
    if (!parsed || parsed.schemaVersion !== 1 || !Array.isArray(parsed.tasks)) return emptyState()
    return { ...emptyState(), ...parsed, overrides: parsed.overrides || {}, assets: parsed.assets || [] }
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyState()
    throw coded('本地分镜批次损坏，请重新加载分镜文档。', 'STATE_CORRUPT')
  }
}

export async function saveState(state) {
  const path = stateFile()
  await mkdir(dirname(path), { recursive: true })
  state.updatedAt = new Date().toISOString()
  const temporary = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, JSON.stringify(state))
  await rename(temporary, path)
  return state
}
