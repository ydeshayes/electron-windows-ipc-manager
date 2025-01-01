export type IPCHandler<T = any, R = any> = (data: T) => Promise<R> | R;

export interface WindowIPCChannel {
  name: string;
  handler: IPCHandler;
}
