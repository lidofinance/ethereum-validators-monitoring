import 'reflect-metadata';
import { DESIGN_IMPLEMENTS } from '../constants';
import { InterfaceTag }      from '../types/InterfaceTag';

/**
 * Class decorator indicating that class implements interface
 *
 * This is needed for proper work of:
 * `foo instanceof IFoo`
 */
export function implementationOf<T>(interfaceTag: InterfaceTag<T>) {
  // tslint:disable-next-line:only-arrow-functions
  return function (target: new (...args: any[]) => T): any {
    const tags: symbol[] = [];

    if (!(interfaceTag instanceof Function)) {
      throw new Error(`'interfaceTag' must be a constructor (Function)`);
    }

    tags.push(interfaceTag.id);

    if (Reflect.hasMetadata(DESIGN_IMPLEMENTS, target)) {
      const existingTags = Reflect.getMetadata(DESIGN_IMPLEMENTS, target);
      tags.push(...existingTags);
    }

    Reflect.defineMetadata(DESIGN_IMPLEMENTS, tags, target);
  }
}
