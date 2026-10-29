// Isolated export/browser test project, never a replacement for a template.
import { buildProject, call, n, P, T } from '../../src/examples/build.js'

export function buildRepetitionGame() {
  return buildProject(`data Model = Model { count :: Int } deriving stock (Eq, Show)
data Msg = Increment deriving stock (Eq, Show)`, {
    initial: [[], [call('f','plus','(+)',['2','']),call('rep',P('repeatN'),'repeatN',['3',n('f'),'0']),call('out',T('Model','Model'),'Model',[n('rep')])], 'out'],
    handle: [['msg','m'], [call('inc','plus','(+)',['1','']),call('out',T('Model','over count'),'over count',[n('inc'),n('m')])], 'out'],
    step: [['dt','m'], [], 'm'],
    view: [['m'], [
      call('value',T('Model','count'),'count',[n('m')]),call('shown',P('show'),'show',[n('value')]),call('label',P('append'),'(++)',['"repeatN: "',n('shown')]),call('text',P('wText'),'text',[n('label')]),
      call('pAny','eq','(==)',['2','']),call('xsAny',P('listOf'),'[ , , ]',['1','2','3']),call('any',P('any'),'any',[n('pAny'),n('xsAny')]),call('showAny',P('show'),'show',[n('any')]),call('labelAny',P('append'),'(++)',['"any: "',n('showAny')]),call('textAny',P('wText'),'text',[n('labelAny')]),
      call('pAll','eq','(==)',['2','']),call('xsAll',P('listOf'),'[ , , ]',['2','2']),call('all',P('all'),'all',[n('pAll'),n('xsAll')]),call('showAll',P('show'),'show',[n('all')]),call('labelAll',P('append'),'(++)',['"all: "',n('showAll')]),call('textAll',P('wText'),'text',[n('labelAll')]),
      call('msg',T('Msg','Increment'),'Increment'),call('button',P('wButton'),'button',['"+1"',n('msg')]),call('widgets',P('listOf'),'[ , , ]',[n('text'),n('textAny'),n('textAll'),n('button')]),call('out',P('wColumn'),'column',[n('widgets')]),
    ], 'out'],
    main: [[], [call('i','initial','initial'),call('v','view','view',['']),call('h','handle','handle',['','']),call('s','step','step',['','']),call('out',P('program'),'program',[n('i'),n('v'),n('h'),n('s')])], 'out'],
  })
}
