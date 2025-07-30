/**
 * Type definitions for the Trade Pulse Snapshot Service
 * Handles Kafka consumption, PostgreSQL updates, REST API, and WebSocket streaming
 */

/**
 * Price tick data structure from Kafka messages
 * This matches the format published by the ingestor service
 */
export interface PriceTick {
  ric: string;        // Reuters Instrument Code (e.g., "AAPL.O", "EUR=")
  price: number;      // Current price
  timestamp: number;  // Unix timestamp in milliseconds
  volume?: number;    // Trading volume (optional)
  bid?: number;       // Bid price (optional)
  ask?: number;       // Ask price (optional)
}

/**
 * Price snapshot stored in PostgreSQL
 */
export interface PriceSnapshot {
  id?: string;           // UUID primary key
  symbol: string;        // Stock symbol (cleaned RIC)
  price: number;         // Current price
  timestamp: number;     // Unix timestamp in milliseconds
  volume?: number;       // Trading volume
  created_at?: Date;     // Row creation timestamp
  updated_at?: Date;     // Row update timestamp
}

/**
 * Configuration for the snapshot service
 */
export interface SnapshotServiceConfig {
  // Kafka configuration
  kafkaBrokers: string[];
  kafkaTopic: string;
  kafkaGroupId: string;
  kafkaClientId: string;

  // PostgreSQL configuration
  postgresHost: string;
  postgresPort: number;
  postgresDatabase: string;
  postgresUser: string;
  postgresPassword: string;
  postgresMaxConnections: number;

  // REST API configuration
  restApiPort: number;
  restApiHost: string;

  // WebSocket configuration
  websocketPort: number;
  websocketHost: string;

  // Metrics configuration
  metricsEnabled: boolean;
  metricsPort: number;
  metricsPath: string;

  // Service configuration
  batchSize: number;
  flushInterval: number;
  maxRetries: number;
}

/**
 * WebSocket message types for client communication
 */
export enum WebSocketMessageType {
  SUBSCRIBE = 'subscribe',
  UNSUBSCRIBE = 'unsubscribe',
  PRICE_UPDATE = 'price_update',
  ERROR = 'error',
  HEARTBEAT = 'heartbeat'
}

/**
 * WebSocket message structure
 */
export interface WebSocketMessage {
  type: WebSocketMessageType;
  symbol?: string;
  symbols?: string[];
  data?: PriceSnapshot | PriceSnapshot[];
  error?: string;
  timestamp: number;
}

/**
 * Client subscription tracking
 */
export interface ClientSubscription {
  clientId: string;
  symbols: Set<string>;
  lastHeartbeat: number;
}

/**
 * REST API response structure
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
  count?: number;
}

/**
 * Database operation result
 */
export interface DatabaseResult {
  success: boolean;
  rowsAffected: number;
  error?: string;
}

/**
 * Service metrics interface
 */
export interface ServiceMetrics {
  kafkaMessagesProcessed: number;
  kafkaMessagesError: number;
  databaseOperationsSuccess: number;
  databaseOperationsError: number;
  websocketConnections: number;
  websocketMessagesOut: number;
  restApiRequests: number;
  restApiErrors: number;
  uptime: number;
}

/**
 * Health check status
 */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  kafka: boolean;
  database: boolean;
  uptime: number;
  timestamp: number;
  errors?: string[];
}
