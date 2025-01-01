import { contextBridge, ipcRenderer } from 'electron';
import type { Windows } from '../shared/windows';
import type { HandlerDefinition } from '../shared/types';
import { IPCClient } from '../renderer/ipc';

type ExposedWindowMethods<W extends keyof Windows, M extends Array<keyof Windows[W]>> = {
  [K in M[number]]: Windows[W][K] extends HandlerDefinition<infer P, infer R>
    ? (params: P) => Promise<R>
    : never;
};

export function exposeApiToGlobalWindow<W extends keyof Windows, M extends Array<keyof Windows[W]>>(
  windowId: string,
  windowName: W,
  methodNames: M
): { [K in W]: ExposedWindowMethods<K, M> } {
  const exposedApi: ExposedWindowMethods<W, M> = {} as any;

  for (const key of methodNames) {
    exposedApi[key] = ((params: any) => {
      const ipc = new IPCClient(windowId, windowName);
      return ipc.invoke(key, params);
    }) as any;
  }

  contextBridge.exposeInMainWorld(windowName, exposedApi);

  return { [windowName]: exposedApi } as { [K in W]: ExposedWindowMethods<K, M> };
}

export const electronHandler = async <T extends Record<string, any>>(
  registerFunctions: (id: string) => T,
  scopeName: string = 'electron'
) => {
  let currentWindowId: string;
  const dataPromise: Promise<any> = new Promise((resolve) =>
    ipcRenderer.once(`window:data`, (_, data: any) => {
      if (!currentWindowId) {
        const { windowId, ...params } = data;
        currentWindowId = windowId;

        ipcRenderer.invoke(`window:${currentWindowId}:ack`);
        resolve(params);
      }
    })
  );

  contextBridge.exposeInMainWorld('electronIPCManager', {
    closeWindow(): Promise<void> {
      return ipcRenderer.invoke(`window:${currentWindowId}:close`);
    },
    getData(): Promise<any> {
      return dataPromise;
    },
    isReady(): Promise<void> {
      return dataPromise;
    },
    async onData(func: (data: any) => void): Promise<void> {
      func(await dataPromise);
    },
  });

  await dataPromise;

  if (currentWindowId!) {
    const exposedApi = registerFunctions(currentWindowId);

    const handlerObject = {
      ...exposedApi,
    };

    contextBridge.exposeInMainWorld(scopeName, handlerObject);

    return handlerObject;
  }
};

declare global {
  interface Window {
    electronIPCManager: {
      isReady(): Promise<void>;
      closeWindow(): Promise<void>;
      getData(): Promise<any>;
      onData(func: (data: any) => void): Promise<void>;
    };
  }
}
