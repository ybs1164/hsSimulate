import { compileSource, compileSourceFiles, evaluateSource, PASTED_SOURCE_ID } from './sourceGraph.js'
import { validateSourceFiles } from './sourceFiles.js'
export const SOURCE_EXAMPLE = 'add :: Int -> Int -> Int\nadd x y = x + y\n\nresult :: Int\nresult = add 3 5\n'
export const SOURCE_STORAGE_KEY = 'hs-simulate:code-document:v1'
export const SOURCE_FILES_STORAGE_KEY = 'hs-simulate:code-files:v1'

// Transactions for one analysis document. Never sees manual-project state.
export class SourceDocument {
  constructor({ save = () => {}, fileMode = false } = {}) {
    Object.assign(this, { text: SOURCE_EXAMPLE, files: fileMode ? [] : null, viewed: null, moduleName: null,
      revision: 0, convertedRevision: -1, evaluation: 0, document: null, selected: null, highlight: null, result: null, error: null, storageError: false, save })
  }
  get stale() { return !this.document || this.revision !== this.convertedRevision }
  get fileId() { return this.files ? this.viewed : PASTED_SOURCE_ID }
  get draft() { return this.files ? (this.files.find(file => file.id === this.viewed)?.source || '') : this.text }
  sourceFile(id = this.fileId) { return this.document?.files.find(file => file.id === id) }
  invalidate() {
    this.revision++
    this.evaluation++
    this.highlight = this.result = this.error = null
  }
  edit(source) {
    if (this.files) {
      const file = this.files.find(file => file.id === this.viewed)
      if (!file) return
      file.source = source
    } else this.text = source
    this.invalidate()
  }
  replaceFiles(incoming) {
    const next = new Map(this.files.map(file => [file.id, file]))
    for (const file of incoming) next.set(file.id, { ...file })
    const files = [...next.values()]
    validateSourceFiles(files)
    this.files = files
    this.viewed = incoming[0]?.id || this.viewed
    this.invalidate()
  }
  removeFile(id) {
    if (!this.files?.some(file => file.id === id)) return
    this.files = this.files.filter(file => file.id !== id)
    if (this.viewed === id) this.viewed = this.files[0]?.id || null
    this.invalidate()
  }
  viewFile(id, save = false) {
    if (!this.files?.some(file => file.id === id) || this.viewed === id) return false
    this.viewed = id
    if (save) this.persist()
    return true
  }
  persist() {
    if (this.stale) return
    const { source, version } = this.document
    const data = this.files
      ? { files: this.document.files, version, viewed: this.viewed, moduleName: this.moduleName, selected: this.selected }
      : { source, version }
    try { this.save(data); this.storageError = false }
    catch { this.storageError = true }
  }
  restore(data) {
    if (!Number.isSafeInteger(data?.version) || data.version < 1) return false
    if (this.files) {
      validateSourceFiles(data.files)
      this.replaceFiles(data.files)
      this.viewFile(data.viewed)
      this.moduleName = data.moduleName
    } else if (typeof data.source === 'string') this.edit(data.source)
    else return false
    if (!this.convert(data.version, false)) return false
    const target = this.document.functions.find(fn => fn.id === data.selected)
    if (this.files && target && target.moduleName === this.moduleName) this.selected = target.id
    return true
  }
  defaultFunction(functions) {
    return functions.find(f => f.name === 'result' && !f.arity) || functions.find(f => !f.arity) || functions[0]
  }
  convert(version = (this.document?.version || 0) + 1, persist = true, preferredModule = this.moduleName) {
    try {
      const next = this.files ? compileSourceFiles(this.files, version) : compileSource(this.draft, version)
      const old = this.document?.functions.find(fn => fn.id === this.selected)
      const module = next.files.find(file => file.moduleName === preferredModule) || next.files.find(file => file.id === this.fileId) || next.files[0]
      const functions = next.functions.filter(fn => fn.moduleName === module.moduleName)
      const target = (this.files && functions.find(fn => fn.name === old?.name)) || this.defaultFunction(functions)
      this.document = next; this.convertedRevision = this.revision
      this.moduleName = module.moduleName
      this.selected = target?.id || null
      this.evaluation++
      this.result = this.highlight = this.error = null
      if (persist) this.persist()
      return true
    } catch (error) { this.error = error; return false }
  }
  selectModule(moduleName) {
    if (!this.document?.files.some(file => file.moduleName === moduleName)) return
    this.moduleName = moduleName
    this.selected = this.defaultFunction(this.document.functions.filter(fn => fn.moduleName === moduleName))?.id || null
    this.evaluation++
    this.result = this.highlight = null
    if (this.files) this.persist()
  }
  selectFunction(id) {
    const fn = this.document?.functions.find(f => f.id === id)
    if (!fn) return
    this.selected = id; this.moduleName = fn.moduleName
    this.evaluation++
    this.result = null
    this.highlight = this.stale ? null : this.document.locations[id]
    if (this.files) this.persist()
  }
  selectNode(id) {
    this.highlight = this.stale ? null : this.document?.locations[id === 'output' ? `${this.selected}:output` : id]
    return this.highlight
  }
  evaluate() {
    if (this.stale || !this.selected) { this.result = null; return null }
    this.highlight = null
    this.result = evaluateSource(this.document, this.selected)
    return this.result
  }
  async evaluateWith(run) {
    if(this.stale || !this.selected)return null
    const doc=this.document, selected=this.selected, revision=this.revision
    const token=++this.evaluation
    this.result=this.highlight=null
    const result=await run(doc,selected)
    if(!result || this.document!==doc || this.selected!==selected || this.revision!==revision || this.evaluation!==token)return null
    this.result=result
    if(result.error?.span)this.highlight={...result.error.span,version:doc.version,kind:'error'}
    return result
  }
}
