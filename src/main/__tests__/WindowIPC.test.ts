/* eslint-disable @typescript-eslint/no-var-requires */

import { BrowserWindow } from 'electron';
import { WindowIPC } from '../WindowIPC';
import { mainHandler, windowName } from '../decorators';

@windowName('exampleWindow')
class TestWindowIPC extends WindowIPC {
  @mainHandler('test')
  async testHandler(data: any): Promise<string> {
    return 'test result';
  }
}

// Mock electron modules
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    removeHandler: jest.fn(),
  },
  BrowserWindow: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
  })),
}));

describe('WindowIPC', () => {
  let windowIPC: WindowIPC;
  let mockWindow: jest.Mocked<BrowserWindow>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockWindow = new BrowserWindow() as jest.Mocked<BrowserWindow>;
    windowIPC = new TestWindowIPC(mockWindow);
  });

  describe('handle', () => {
    it('should register a handler for a channel', async () => {
      const mockHandler = jest.fn().mockResolvedValue('test result');
      const channelName = 'test-channel';

      windowIPC.handle(channelName, mockHandler);

      // Get the registered handler from ipcMain.handle mock
      const registeredHandler = (require('electron').ipcMain.handle as jest.Mock).mock.calls[2][1];

      // Test the handler
      const result = await registeredHandler({}, 'test-data');

      expect(mockHandler).toHaveBeenCalledWith('test-data');
      expect(result).toEqual({
        success: true,
        data: 'test result',
      });
    });

    it('should register a typed handler', async () => {
      const mockHandler = jest.fn().mockResolvedValue('test result');
      const channelName = 'test-channel';

      windowIPC.handle<string, string>(channelName, mockHandler);

      const registeredHandler = (require('electron').ipcMain.handle as jest.Mock).mock.calls[0][1];
      const result = await registeredHandler({}, 'test-data');

      expect(result).toEqual({
        success: true,
        data: 'test result',
      });
    });

    // Explain this test
    // This test is to check if the handler can handle errors
    it('should handle errors in handler', async () => {
      const mockHandler = jest.fn().mockRejectedValue(new Error('test error'));
      const channelName = 'test-channel';

      windowIPC.handle(channelName, mockHandler);

      const registeredHandler = (require('electron').ipcMain.handle as jest.Mock).mock.calls[2][1];
      const result = await registeredHandler({}, 'test-data');

      expect(result).toEqual({
        success: false,
        error: 'test error',
      });
    });
    it('should throw error when registering duplicate handler', () => {
      const channelName = 'test-channel';
      const mockHandler = jest.fn();

      windowIPC.handle(channelName, mockHandler);

      expect(() => {
        windowIPC.handle(channelName, mockHandler);
      }).toThrow(`Handler already registered for channel: ${channelName}`);
    });
  });

  describe('removeHandler', () => {
    it('should remove a registered handler', () => {
      const channelName = 'test-channel';
      const mockHandler = jest.fn();

      windowIPC.handle(channelName, mockHandler);
      windowIPC.removeHandler(channelName);

      const { ipcMain } = require('electron');
      expect(ipcMain.removeHandler).toHaveBeenCalledWith(expect.stringContaining(channelName));
    });
  });

  describe('removeAllHandlers', () => {
    it('should remove all registered handlers', () => {
      const mockHandler = jest.fn();

      windowIPC.handle('channel1', mockHandler);
      windowIPC.handle('channel2', mockHandler);
      windowIPC.removeAllHandlers();

      const { ipcMain } = require('electron');
      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(5);
    });
  });

  describe('getWindowId', () => {
    it('should return a window ID', () => {
      const windowId = windowIPC.getWindowId();
      expect(typeof windowId).toBe('string');
      expect(windowId.length).toBe(5);
    });
  });

  describe('mainHandler decorator', () => {
    it('should register the testHandler "test" in the main process', async () => {
      // Check that the testHandler "test" is registered in the main process
      const { ipcMain } = require('electron');
      expect(ipcMain.handle).toHaveBeenCalledWith(
        `${windowIPC.getWindowId()}:test`,
        expect.any(Function)
      );
    });
  });
});
