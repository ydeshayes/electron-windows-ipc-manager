export interface HandlerDefinition<P, R> {
  params: P;
  returns: R;
  handler: Function;
}

export interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
