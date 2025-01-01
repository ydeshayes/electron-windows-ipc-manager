import 'reflect-metadata';

const IPC_HANDLERS = Symbol('ipcHandlers');
const WINDOW_NAME = Symbol('windowName');
const PENDING_HANDLERS = Symbol('pendingHandlers');
const RESPONSE_HANDLERS = Symbol('responseHandlers');

export type IPCHandler<P, R> = {
  params: P;
  returns: R;
  handler: Function;
  waitForResponse?: boolean;
};

export type WindowType = {
  [methodName: string]: IPCHandler<any, any>;
};

export type Windows = {
  [windowName: string]: {
    [methodName: string]: IPCHandler<any, any>;
  };
};

export const windowRegistry: Windows = {};

export type HandlerMetadata = {
  name: string;
  descriptor: PropertyDescriptor;
  waitForResponse?: boolean;
};

// Update the windowName decorator to handle response handlers
export function windowName<T extends Windows[keyof Windows]>(name: keyof Windows) {
  return function (target: any) {
    target[WINDOW_NAME] = name;
    windowRegistry[name] = {} as T;

    // Process any pending handlers
    const pendingHandlers: HandlerMetadata[] = target[PENDING_HANDLERS] || [];
    pendingHandlers.forEach(({ name: handlerName, descriptor, waitForResponse }) => {
      windowRegistry[name][handlerName] = {
        params: undefined,
        returns: undefined,
        handler: descriptor.value,
        waitForResponse: waitForResponse,
      };

      if (!target[IPC_HANDLERS]) {
        target[IPC_HANDLERS] = new Map<string, Function>();
      }
      if (!target[RESPONSE_HANDLERS]) {
        target[RESPONSE_HANDLERS] = new Set<string>();
      }

      target[IPC_HANDLERS].set(handlerName, descriptor.value);
      if (waitForResponse) {
        target[RESPONSE_HANDLERS].add(handlerName);
      }
    });

    return target;
  };
}

export function responseHandler<T>() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<(...args: any[]) => Promise<any>>
  ) {
    const constructor = target.constructor;

    if (!constructor[RESPONSE_HANDLERS]) {
      constructor[RESPONSE_HANDLERS] = new Set<string>();
    }

    constructor[RESPONSE_HANDLERS].add(propertyKey);
    return descriptor;
  };
}

// Update the mainHandler decorator
export function mainHandler(name: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const constructor = target.constructor;
    const waitForResponse = constructor[RESPONSE_HANDLERS]?.has(propertyKey);

    if (constructor[WINDOW_NAME]) {
      const windowName = constructor[WINDOW_NAME];

      windowRegistry[windowName][name] = {
        params: undefined,
        returns: undefined,
        handler: descriptor.value,
        waitForResponse,
      };

      if (!constructor[IPC_HANDLERS]) {
        constructor[IPC_HANDLERS] = new Map<string, Function>();
      }

      constructor[IPC_HANDLERS].set(name, descriptor.value);
    } else {
      if (!constructor[PENDING_HANDLERS]) {
        constructor[PENDING_HANDLERS] = [];
      }
      constructor[PENDING_HANDLERS].push({
        name,
        descriptor,
        waitForResponse,
      });
    }

    return descriptor;
  };
}

export function isResponseHandler(target: any, handlerName: string): boolean {
  return target.constructor[RESPONSE_HANDLERS]?.has(handlerName) || false;
}

export function getClassHandlers(target: any): Map<string, Function> {
  return target.constructor[IPC_HANDLERS] || new Map<string, Function>();
}
