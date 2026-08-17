declare module 'proxy-chain' {
  export type PrepareRequestFunctionParams = {
    request: {
      url?: string;
      headers?: Record<string, string | string[] | undefined>;
    };
    hostname?: string;
    port?: number;
    isHttp?: boolean;
    connectionId?: number | string;
  };

  export type PrepareRequestFunctionResult =
    | { upstreamProxyUrl: string; customTag?: unknown }
    | undefined;

  export type PrepareRequestFunction =
    | ((params: PrepareRequestFunctionParams) => PrepareRequestFunctionResult)
    | ((params: PrepareRequestFunctionParams) => Promise<PrepareRequestFunctionResult>);

  export type ServerOptions = {
    host?: string;
    port?: number;
    prepareRequestFunction?: PrepareRequestFunction;
  };

  export class Server {
    constructor(options: ServerOptions);
    listen(): Promise<void>;
    close(force?: boolean): Promise<void>;
    getConnectionIds(): Array<number | string>;
    closeConnection(connectionId: number | string): void;
    closeConnections(): void;
    on(event: 'connectionClosed', listener: (info: { connectionId: number | string }) => void): this;
    on(
      event: 'tunnelConnectResponded' | 'tunnelConnectFailed',
      listener: (info: { customTag?: unknown; response?: { statusCode?: number } }) => void,
    ): this;
    server: {
      address(): import('net').AddressInfo | string | null;
    };
  }
}
