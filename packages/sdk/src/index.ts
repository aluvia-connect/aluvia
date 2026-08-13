// Aluvia Client Node
// Main entry point

// Public class
export { AluviaClient } from './client/AluviaClient.js';
export { AluviaApi } from './api/AluviaApi.js';

// Loopback hostname check (always direct in ProxyServer)
export { isLoopbackHostname } from './client/loopback.js';

// Connect helper
export { connect } from './connect.js';
export type { ConnectResult } from './connect.js';

// Public error classes
export {
  MissingApiKeyError,
  InvalidApiKeyError,
  ApiError,
  PaymentRequiredError,
  ProxyStartError,
  ConnectError,
} from './errors.js';

// Session lock utilities (used by CLI)
export {
  writeLock,
  readLock,
  removeLock,
  isProcessAlive,
  getLogFilePath,
  validateSessionName,
  generateSessionName,
  listSessions,
  toLockData,
} from './session/lock.js';

export type { LockData, LockDetection, SessionInfo } from './session/lock.js';

// Public types
export type {
  GatewayProtocol,
  LogLevel,
  AluviaClientOptions,
  AluviaClientConnection,
  PlaywrightProxySettings,
  BlockDetectionConfig,
  BlockDetectionResult,
  DetectionBlockStatus,
  DetectionSignal,
  RedirectHop,
} from './client/types.js';

export type {
  Account,
  AccountUsage,
  AccountPayment,
  AccountConnection,
  AccountConnectionDeleteResult,
  Geo,
  SuccessEnvelope,
  ErrorEnvelope,
  Envelope,
} from './api/types.js';
