import { evaluateSource } from './sourceGraph.js'

self.onmessage = ({data:{document,functionId}}) => {
  try {
    const result = evaluateSource(document,functionId)
    // Graph/Map references stay inside the worker. IDs identify each invocation.
    const events = result.allEvents.map(({graph,frame,...event}) => event)
    const error = result.error && Object.fromEntries(['message','stage','span','line','column'].map(k=>[k,result.error[k]]))
    self.postMessage({value:result.value,error,events:result.events,allEvents:events})
  } catch(error) {
    self.postMessage({error:{message:error.message,stage:error.stage,span:error.span},events:[],allEvents:[]})
  }
}
