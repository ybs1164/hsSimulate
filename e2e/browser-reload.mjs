import { setTimeout as delay } from 'node:timers/promises'

export async function reloadApp(evaluate) {
  // A reload can destroy the context that requested it. Reply before starting
  // navigation, then wait for the editor in the new document.
  const previous = await evaluate('performance.timeOrigin')
  if (!Number.isFinite(previous)) throw new Error('Could not identify the document before reload')
  await evaluate('void setTimeout(() => location.reload(), 50)')
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    await delay(100)
    const ready = await evaluate(
      'performance.timeOrigin !== ' + previous + " && Boolean(document.querySelector('.workspace-resizer'))",
    ).catch(() => false)
    if (ready) return
  }
  throw new Error('Reloaded editor did not become ready')
}
