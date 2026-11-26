import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { unzipSync, strFromU8 } from 'fflate'
import { coded } from './errors.mjs'

const require = createRequire(import.meta.url)
const core = require('../vendor/core.cjs')

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const MAX_BYTES = 25 * 1024 * 1024

export function parseStoryboard(text) {
  return core.parseText(text)
}

export function matchStoryboard(tasks, assets, overrides) {
  const matched = core.matchAssets(tasks, assets, overrides, { optionalKinds: ['道具'] })
  return { tasks: matched, summary: core.summarize(matched) }
}

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('gb18030').decode(bytes).replace(/^\uFEFF/, '')
  }
}

function extractDocx(bytes) {
  let files
  try {
    files = unzipSync(bytes, { filter: entry => entry.name === 'word/document.xml' })
  } catch {
    throw coded('无法解压 DOCX，请确认文件没有损坏或加密。', 'DOCUMENT_INVALID')
  }
  const xmlBytes = files['word/document.xml']
  if (!xmlBytes) throw coded('DOCX 缺少 word/document.xml 正文。', 'DOCUMENT_INVALID')
  const xml = strFromU8(xmlBytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw coded('DOCX 包含不支持的 XML 声明。', 'DOCUMENT_INVALID')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const paragraphs = Array.from(doc.getElementsByTagNameNS(WORD_NS, 'p'))
  return paragraphs.map(paragraph => {
    let text = ''
    const visit = node => {
      if (node.nodeType === 1 && node.namespaceURI === WORD_NS) {
        const local = node.localName
        if (local === 't') {
          text += node.textContent || ''
          return
        }
        if (local === 'tab') {
          text += '\t'
          return
        }
        if (local === 'br' || local === 'cr') {
          text += '\n'
          return
        }
      }
      for (let child = node.firstChild; child; child = child.nextSibling) visit(child)
    }
    visit(paragraph)
    return text
  }).join('\n')
}

export async function readStoryboardFile(filePath) {
  const bytes = await readFile(filePath)
  if (bytes.length > MAX_BYTES) throw coded('文档不能超过 25 MB。', 'DOCUMENT_TOO_LARGE')
  const extension = extname(filePath).toLowerCase()
  let text
  if (extension === '.txt' || extension === '.md') text = decodeText(bytes)
  else if (extension === '.docx') text = extractDocx(bytes)
  else throw coded('分镜文档支持 TXT、MD、DOCX，也可以直接传文本。', 'DOCUMENT_TYPE')
  if (!String(text).trim()) throw coded('文档中没有可读取的文本。', 'DOCUMENT_EMPTY')
  return { name: basename(filePath), text }
}
