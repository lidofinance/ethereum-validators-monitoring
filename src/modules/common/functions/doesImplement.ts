import 'reflect-metadata';
import { DESIGN_IMPLEMENTS } from '../constants';
import { InterfaceTag }      from '../types/InterfaceTag';

/**
 * Checks that target implements specific interface
 */
export function doesImplement<T>(target: T | any, interfaceTag: InterfaceTag<any>): target is T {
  if (typeof target === 'undefined') {
    return false;
  }

  if (Reflect.hasMetadata(DESIGN_IMPLEMENTS, target.constructor)) {
    const tags: symbol[] = Reflect.getMetadata(DESIGN_IMPLEMENTS, target.constructor);
    let tag: symbol;

    if (interfaceTag instanceof Function) {
      tag = interfaceTag.id;
    } else {
      throw new Error(`'interfaceTag' must be a constructor (Function)`);
    }

    return tags.indexOf(tag) >= 0;
  }

  return false;
}
