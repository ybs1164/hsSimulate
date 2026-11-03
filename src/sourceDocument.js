import { compileSource, evaluateSource } from './sourceGraph.js'
export const SOURCE_EXAMPLE = 'add :: Int -> Int -> Int\nadd x y = x + y\n\nresult :: Int\nresult = add 3 5\n'
export const SOURCE_STORAGE_KEY = 'hs-simulate:code-document:v1'

// Transactions for one analysis document. Never sees manual-project state.
export class SourceDocument {
  constructor({ save = () => {} } = {}) {
    Object.assign(this, { draft: SOURCE_EXAMPLE, revision: 0, convertedRevision: -1, document: null, selected: null, highlight: null, result: null, error: null, save })
  }
  get stale() { return !this.document || this.revision !== this.convertedRevision }
  edit(source) {
    this.draft = source; this.revision++
    this.highlight = this.result = this.error = null
  }
  convert(version = (this.document?.version || 0) + 1, persist = true) {
    try {
      const next = compileSource(this.draft, version)
      this.document = next; this.convertedRevision = this.revision
      this.selected = next.functions.find(f => f.name === 'result' && !f.arity)?.id || next.functions.find(f => !f.arity)?.id || next.functions[0].id
      this.result = this.highlight = this.error = null
      if (persist) { try { this.save({ source: next.source, version: next.version }) } catch { /* usable even when storage is unavailable */ } }
      return true
    } catch (error) { this.error = error; return false }
  }
  selectFunction(id) {
    if (!this.document?.functions.some(f => f.id === id)) return
    this.selected = id; this.result = null
    this.highlight = this.stale ? null : this.document.locations[id]
  }
  selectNode(id) {
    this.highlight = this.stale ? null : this.document?.locations[id === 'output' ? `${this.selected}:output` : id]
    return this.highlight
  }
  evaluate() {
    if (this.stale) { this.result = null; return null }
    this.highlight = null
    this.result = evaluateSource(this.document, this.selected)
    return this.result
  }
  async evaluateWith(run) {
    if(this.stale)return null
    const doc=this.document, selected=this.selected, revision=this.revision
    this.result=this.highlight=null
    const result=await run(doc,selected)
    if(!result || this.document!==doc || this.selected!==selected || this.revision!==revision)return null
    this.result=result
    if(result.error?.span)this.highlight={...result.error.span,version:doc.version,kind:'error'}
    return result
  }
}
