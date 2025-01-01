# Electron IPC

Simplify and add type safety to IPC communication between the main process and renderer processes in an Electron application.

## Scoped IPC

This library exposes a `WindowIPC` abstract class that you can extend to create a new window manager. You can then use the `@mainHandler` decorator to define a ipc handler for a method. When the manager start, it will send informations to the renderer in the web window so that the renderer can call the methods. With that, you can make sure that the renderer is talking to the right window.

# Example Usage

## Main process side:

```ts
@windowName("ExampleWindow")
class ExampleWindow extends Window {
@mainHandler("greeting")
  greeting(name: string) {
    return `Hello, ${name}`;
  }
}
```

### Generate the types:

```bash
npx generate-ipc-types
```

Then you can use the library front-end side:
### Preload side:
```ts
import { electronHandler, exposeApiToGlobalWindow } from './ipc';

const handler = electronHandler((id: string) => ({
  ...exposeApiToGlobalWindow(id, 'ExampleWindow', [
    'greeting',
  ])
}), 'MyAPI'); 

type ExampleWindowAPIType = typeof handler;

declare global {
  interface Window  {
    MyAPI: Awaited<ExampleWindowAPIType>;
  }
}
```

You can now use the `electron` object in the window to call the methods defined in the `ExampleWindow` class.

```ts
window.MyAPI.ExampleWindow.greeting("John");
```

### Using renderer directly:
```ts
import { IPCClient } from './ipc';

async function example(windowId: string) {
  const ipc = new IPCClient(windowId, 'ExampleWindow');

  // Fully type-safe!
  const greeting = await ipc.invoke('greeting', 'q');
  const data = await ipc.invoke('getData', { id: 123 });
} 
```

### Using response handlers:

You can use the `responseHandler` decorator to define a response handler for a method.

```ts
@mainHandler('getData')
@responseHandler<{ id: number; }>()
async getData(data: { id: number; }) {
  return data;
}
```

The `getData` invoker will now wait for the response handler to be called before resolving.

You can use the `getDataResponse` function to call the response handler anywhere in front-end where this function is available.

```ts
await window.MyAPI.ExampleWindow.getDataResponse({ id: 123 });
```