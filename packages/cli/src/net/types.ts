export type GatewayProtocol = 'http' | 'https';

export type LogLevel = 'silent' | 'info' | 'debug';

export type SuccessEnvelope<T> = {
  success: true;
  data: T;
};

export type ErrorEnvelope = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type Envelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export type Account = Record<string, unknown>;

export type AccountUsage = Record<string, unknown>;

export type Geo = Record<string, unknown>;
