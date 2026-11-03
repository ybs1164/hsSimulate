import { builtinSchemes } from './builtinSchemes.js'
import { scheme, tcon, tfun } from './typeSystem.js'

export const sourceOps = {
  '+':['plus','+',2], '-':['minus','−',2], '*':['times','×',2], negate:['negate','negate',1],
  '==':['eq','==',2], '/=':['neq','/=',2], '<':['lt','<',2], '<=':['le','<=',2], '>':['gt','>',2], '>=':['geq','>=',2],
  '&&':['and','&&',2], '||':['or','||',2], if:['select','if',3],
  ':':['cons',':',2], '++':['append','++',2], nil:['nil','[]',0], apply:['apply','함수 적용',2],
  abs:['abs','abs',1], div:['div','div',2], mod:['mod','mod',2],
  map:['map','map',2], filter:['filter','filter',2], foldl:['foldl','foldl',3],
}
export const sourceNames = new Set(['abs','div','mod','map','filter','foldl'])
const Int=tcon('Int'), Bool=tcon('Bool')
const arrows=(args,result)=>args.reduceRight((r,a)=>tfun(a,r),result)
const fixed=(args,result)=>scheme([],[],arrows(args,result))
// List/HOF schemes are the app's actual polymorphic builtin schemes.
export function sourceScheme(name) {
  if(['+','-','*','div','mod'].includes(name))return fixed([Int,Int],Int)
  if(['abs','negate'].includes(name))return fixed([Int],Int)
  if(['==','/=','<','<=','>','>='].includes(name))return fixed([Int,Int],Bool)
  return builtinSchemes[sourceOps[name][0]]
}
