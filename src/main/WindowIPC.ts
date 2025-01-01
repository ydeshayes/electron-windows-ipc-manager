import { BrowserWindow, ipcMain } from 'electron';
import { IPCHandler, WindowIPCChannel } from './types';
import { IPCResponse } from '../shared/types';
import { getClassHandlers, isResponseHandler } from './decorators';

export abstract class WindowIPC {
  public channels: Map<string, WindowIPCChannel> = new Map();
  private window: BrowserWindow;
  private windowId: string;

  constructor(window: BrowserWindow, data: any = {}) {
    this.window = window;
    this.windowId = Math.random().toString(36).substring(2, 7);

    // Register all handlers defined with @mainHandler
    const handlers = getClassHandlers(this);
    handlers.forEach((handler, channelName) => {
      this.handle(channelName, handler.bind(this));
    });

    this.handle(`window:${this.windowId}:close`, () => {
      this.closeWindow();
    });

    // Clean up handlers when window is closed
    this.window.on('closed', () => {
      this.removeAllHandlers();
    });

    if (data) {
      // Send data to the renderer
      this.window.webContents?.on('did-finish-load', () => {
        const interval = setInterval(() => {
          this.window.webContents.send(`window:data`, {
            ...data,
            windowId: this.windowId,
          });
        }, 2000);

        ipcMain.handleOnce(`window:${this.windowId}:ack`, () => {
          clearInterval(interval);
        });
      });
    }
  }

  getScopedChannelName(channelName: string): string {
    return `${this.windowId}:${channelName}`;
  }

  closeWindow(): void {
    this.window?.close();
  }

  handleResponse<T = any>(channelName: string): Promise<T> {
    const scopedChannelName = this.getScopedChannelName(channelName);

    return new Promise((resolve) =>
      ipcMain.handleOnce(
        `${this.windowId}:${scopedChannelName}Response`,
        async (event: any, data: any) => {
          resolve(data);
        }
      )
    );
  }

  handle<T = any, R = any>(channelName: string, handler: IPCHandler<T, R>): void {
    const scopedChannelName = this.getScopedChannelName(channelName);

    if (this.channels.has(scopedChannelName)) {
      throw new Error(`Handler already registered for channel: ${channelName}`);
    }

    const channel: WindowIPCChannel = {
      name: scopedChannelName,
      handler,
    };

    this.channels.set(scopedChannelName, channel);

    let responsePromise: Promise<any>;

    if (isResponseHandler(this, channelName)) {
      responsePromise = this.handleResponse(channelName);
    }

    ipcMain.handle(scopedChannelName, async (event: any, data: any) => {
      try {
        const result = await handler(data);

        // Check if this is a response handler
        if (responsePromise) {
          // Wait for renderer response
          const response = await responsePromise;
          return {
            success: true,
            data: response,
          } as IPCResponse<R>;
        }

        return {
          success: true,
          data: result,
        } as IPCResponse<R>;
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        } as IPCResponse<R>;
      }
    });
  }

  removeHandler(channelName: string): void {
    const scopedChannelName = this.getScopedChannelName(channelName);
    if (this.channels.has(scopedChannelName)) {
      ipcMain.removeHandler(scopedChannelName);
      this.channels.delete(scopedChannelName);
    }
  }

  removeAllHandlers(): void {
    for (const [channelName] of this.channels) {
      ipcMain.removeHandler(channelName);
    }
    this.channels.clear();

    // Remove default handlers
    ipcMain.removeHandler(`window:${this.windowId}:close`);
  }

  getWindowId(): string {
    return this.windowId;
  }

  getWindow(): BrowserWindow {
    return this.window;
  }
}
