// Like Haskell's Prelude: one import that brings every class and instance
// declaration into scope together with the solver that uses them. Import the
// solver from here rather than from classEnv.js directly, so the class
// environment is never consulted before its declarations have loaded.
import './numericClasses.js'
import './dataTypes.js'

export { ContextError, classClosure, classNames, defaultTypes, entails, instancesOf, isClass, listInstances, pickDefault, predsOnVar, reduce, setDynamicInstances, simplify, superclassesOf, withDynamicInstances } from './classEnv.js'
export { literalClass, numericTypes } from './numericClasses.js'
