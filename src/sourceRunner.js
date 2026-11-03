// Actual calculation lives in a disposable worker, separately from trace playback.
export function createSourceRunner({ makeWorker = () => new Worker(new URL('./sourceWorker.js', import.meta.url), { type:'module' }), timeout = 4000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let pending = null
  function cancel() {
    if (!pending) return
    const old = pending; pending = null
    clearTimer(old.timer); old.worker.terminate(); old.resolve(null)
  }
  return {
    cancel,
    run(document, functionId) {
      cancel()
      return new Promise(resolve => {
        let worker
        try { worker = makeWorker() }
        catch { resolve({error:{message:'계산 Worker를 시작하지 못했습니다.',stage:'worker'},events:[],allEvents:[]});return }
        const entry = {worker,resolve,timer:null}
        pending = entry
        const finish = result => {
          if (pending !== entry) return
          pending = null; clearTimer(entry.timer); worker.terminate(); resolve(result)
        }
        worker.onmessage = event => finish(event.data)
        worker.onerror = () => finish({error:{message:'계산 Worker를 실행하지 못했습니다.',stage:'worker'},events:[],allEvents:[]})
        entry.timer = setTimer(() => finish({error:{message:'코드 계산 시간 제한(4초)을 초과해 Worker를 중단했습니다.',stage:'limit'},events:[],allEvents:[]}),timeout)
        worker.postMessage({document,functionId})
      })
    },
  }
}
