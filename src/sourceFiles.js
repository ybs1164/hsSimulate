import { parseSource } from './sourceParser.js'

export const MAX_SOURCE_FILES = 12
export const MAX_SOURCE_CHARS = 40000
const MAX_PROJECT_CHARS = 120000

export function validateSourceFiles(files) {
  if (!Array.isArray(files) || files.length > MAX_SOURCE_FILES) throw new Error(`.hs 파일은 최대 ${MAX_SOURCE_FILES}개입니다.`)
  const ids = new Set()
  let total = 0
  for (const file of files) {
    if (typeof file?.id !== 'string' || !file.id || typeof file.name !== 'string' || typeof file.source !== 'string' || ids.has(file.id)) {
      throw new Error('파일 식별자 또는 저장 형식이 올바르지 않습니다.')
    }
    ids.add(file.id)
    if (file.source.length > MAX_SOURCE_CHARS) throw new Error(`${file.name}: 파일당 ${MAX_SOURCE_CHARS.toLocaleString()}자까지 지원합니다.`)
    total += file.source.length
  }
  if (total > MAX_PROJECT_CHARS) throw new Error(`전체 파일은 ${MAX_PROJECT_CHARS.toLocaleString()}자까지 지원합니다.`)
}

export async function readSelectedSourceFiles(files) {
  if (files.length > MAX_SOURCE_FILES) throw new Error(`.hs 파일은 최대 ${MAX_SOURCE_FILES}개입니다.`)
  const results = await Promise.all(files.map(async file => {
    if (!/\.hs$/i.test(file.name)) throw new Error(`${file.name}: .hs 파일을 선택하세요.`)
    if (file.size > MAX_SOURCE_CHARS * 4 + 3) throw new Error(`${file.name}: 파일이 너무 큽니다.`)
    try {
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      const source = raw.replace(/\r\n?/g, '\n')
      let moduleName
      try { moduleName = parseSource(source).module?.name || 'Main' }
      catch { /* Conversion reports the syntax error with its source location. */ }
      return { id: 'file:' + file.name, name: file.name, source, moduleName }
    } catch {
      throw new Error(`${file.name}: 파일을 읽지 못했습니다. 올바른 UTF-8 .hs 파일인지 확인하세요.`)
    }
  }))
  validateSourceFiles(results)
  return results
}
