import { ipcRenderer } from 'electron';
import { IPCResponse, HandlerDefinition } from '../shared/types';
import { WindowDefinitions, Windows } from '../shared/windows';

export class IPCClient<T extends keyof WindowDefinitions> {
  private windowId: string;
  private windowName: T;

  constructor(windowId: string, windowName: T) {
    this.windowId = windowId;
    this.windowName = windowName;
  }

  async invoke<K extends keyof Windows[T], H = Windows[T][K]>(
    method: K,
    data: H extends HandlerDefinition<infer P, any> ? P : never
  ): Promise<H extends HandlerDefinition<infer P, infer R> ? Promise<R> : never> {
    const response = (await ipcRenderer.invoke(
      this.getScopedChannelName(method as string),
      data
    )) as IPCResponse<H extends HandlerDefinition<infer P, infer R> ? Promise<R> : never>;

    if (!response.success) {
      throw new Error(response.error || 'Unknown error');
    }

    return response.data!;
  }

  private getScopedChannelName(channelName: string): string {
    return `${this.windowId}:${channelName}`;
  }

  getWindowName(): T {
    return this.windowName;
  }
}
