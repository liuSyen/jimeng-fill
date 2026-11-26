import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { coded } from './errors.mjs'

const IMAGE = /\.(?:png|jpe?g|webp|gif|bmp|avif|heic|tiff?)$/i
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic'
}

export function mimeType(name) {
  return MIME[extname(name).toLowerCase()] || 'application/octet-stream'
}

export async function hashFile(filePath) {
  const bytes = await readFile(filePath)
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }
}

export async function scanReferences(dir) {
  const info = await stat(dir)
  if (!info.isDirectory()) throw coded('参考图目录不是文件夹。', 'ASSET_DIR')
  const assets = []
  async function walk(current, depth) {
    if (depth > 6) return
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      if (entry.isSymbolicLink()) continue
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !IMAGE.test(entry.name)) continue
      const file = await hashFile(full)
      assets.push({
        id: relative(dir, full).split('\\').join('/'),
        name: entry.name,
        path: full,
        size: file.size,
        sha256: file.sha256
      })
      if (assets.length > 2000) throw coded('参考图超过 2000 张，请缩小目录后再匹配。', 'ASSET_TOO_MANY')
    }
  }
  await walk(dir, 0)
  return assets
}
