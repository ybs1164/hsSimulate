// Export a game as one self-contained HTML file: the player's modules,
// bundled into a single script, plus the flattened project as JSON.
//
// The bundler is deliberately tiny — it only has to handle this project's
// own module style: one-line `import { a, b as c } from './x.js'` /
// `import './x.js'` statements and `export function|class|const|let` /
// `export { a, b }` declarations. Each module runs in its own function
// scope (so top-level names can't collide) and returns its exports, in
// dependency order. Anything else it meets is an error, not a silent
// mis-bundle.

/** The modules an exported game needs, in dependency order. */
export const PLAYER_MODULES = ['typeSystem', 'classEnv', 'dataTypes', 'literals', 'evaluator', 'runtime', 'player']

export class BundleError extends Error {}

function transformModule(name, code) {
  const exported = []
  const lines = code.split(/\r?\n/).map((line) => {
    let m
    if ((m = line.match(/^import\s+\{([^}]*)\}\s+from\s+'\.\/([\w/]+)\.js'\s*;?\s*$/))) {
      const bindings = m[1].split(',').map((b) => b.trim()).filter(Boolean).map((b) => b.replace(/\s+as\s+/, ': '))
      return `const { ${bindings.join(', ')} } = __m[${JSON.stringify(m[2])}]`
    }
    if ((m = line.match(/^import\s+'\.\/([\w/]+)\.js'\s*;?\s*$/))) return `void __m[${JSON.stringify(m[1])}]`
    if ((m = line.match(/^export\s+(?:async\s+)?(function\*?|class|const|let)\s+([A-Za-z_$][\w$]*)/))) {
      exported.push(m[2])
      return line.replace(/^export\s+/, '')
    }
    if ((m = line.match(/^export\s+\{([^}]*)\}\s*;?\s*$/))) {
      exported.push(...m[1].split(',').map((b) => b.trim()).filter(Boolean))
      return ''
    }
    if (/^\s*(import|export)\b/.test(line)) throw new BundleError(`${name}.js: can't bundle "${line.trim()}"`)
    return line
  })
  return `__m[${JSON.stringify(name)}] = (() => {\n${lines.join('\n')}\nreturn { ${exported.join(', ')} }\n})()`
}

/** One script defining `const __m = { moduleName: exports, … }` from `sources` (name → code). */
export function bundleModules(sources, order = PLAYER_MODULES) {
  const missing = order.filter((name) => typeof sources[name] !== 'string')
  if (missing.length) throw new BundleError(`missing module source: ${missing.join(', ')}`)
  return `const __m = {}\n${order.map((name) => transformModule(name, sources[name])).join('\n')}`
}

const escapeHtml = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;')

/**
 * The complete HTML page. `data` = { title, definitions, functionBodies,
 * types, entry, exactTime } (see player.js' startPlayer).
 */
export function buildPlayerHtml(data, sources) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c') // never closes the script element
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
</head>
<body>
<div id="game"></div>
<script id="game-data" type="application/json">${json}</script>
<script>
(() => {
${bundleModules(sources)}
document.head.append(Object.assign(document.createElement('style'), { textContent: __m.player.PLAYER_CSS }))
const data = JSON.parse(document.getElementById('game-data').textContent)
try {
  __m.player.startPlayer(data, document.getElementById('game'))
} catch (error) {
  document.getElementById('game').textContent = 'This game could not start: ' + error.message
}
})()
</script>
</body>
</html>
`
}
