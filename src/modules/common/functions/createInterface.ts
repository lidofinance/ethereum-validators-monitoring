import { doesImplement }     from './doesImplement';
import { InterfaceTag }      from '../types/InterfaceTag';
import { INTERFACE_MAP_KEY } from '../constants';

/**
 * Creates special interface-like service identifier that acts like interface
 */
export function createInterface<I>(name: string): InterfaceTag<I> {
  const id = Symbol.for(name);

  // @ts-ignore
  if (!global[INTERFACE_MAP_KEY]) {
    // @ts-ignore
    global[INTERFACE_MAP_KEY] = new Map<symbol, InterfaceTag<any>>();
  }


  const interfaceMap: Map<symbol, InterfaceTag<any>> =
    // @ts-ignore
    global[INTERFACE_MAP_KEY];

  const foundInterfaceTag = interfaceMap.get(id);

  if (foundInterfaceTag) {
    return <InterfaceTag<I>>foundInterfaceTag;
  }

  const newInterfaceTag = (class {
    private static readonly tag: symbol = id;

    static [Symbol.hasInstance](instance: unknown) {
      return doesImplement(instance, this);
    };

    public static get id(): symbol {
      return this.tag;
    }
  });

  Object.defineProperty(newInterfaceTag, 'name', {value: name, writable: false});
  Object.freeze(newInterfaceTag);

  interfaceMap.set(id, newInterfaceTag);

  return (<InterfaceTag<I>>(<any>newInterfaceTag));
}
