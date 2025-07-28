/**
 * Type definitions for the Trade Pulse Ingestor Service
 * Handles TCP message parsing, validation, and Kafka publishing
 */

/**
 * Parsed price tick data structure
 * This matches the format sent by the tick-generator service
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
 * Raw message received via TCP before parsing
 */
export interface RawMessage {
  data: string;
  clientId: string;    // Unique identifier for the TCP client connection
  receivedAt: number;  // Server timestamp when message was received
}

/**
 * Validation result for incoming messages
 */
export interface ValidationResult {
  isValid: boolean;
  tick?: PriceTick;
  errors: string[];
}

/**
 * Enriched tick data with server-side metadata for Kafka publishing
 */
export interface EnrichedTick extends PriceTick {
  // Server-side enrichment
  receivedAt: number;    // Server timestamp when message was received
  clientId: string;      // TCP client that sent this tick
  sequenceId: string;    // Unique sequence identifier for this message
  
  // Calculated fields
  latencyMs?: number;    // Calculated latency from tick timestamp to received timestamp
  
  // Validation metadata
  validationPassed: boolean;
  validationErrors: string[];
}

/**
 * TCP server configuration options
 */
export interface TcpServerConfig {
  host: string;
  port: number;
  maxConnections: number;
  keepAlive: boolean;
  keepAliveInitialDelay: number;
}

/**
 * Kafka configuration options
 */
export interface KafkaConfig {
  brokers: string[];
  clientId: string;
  topic: string;
  acks: number;           // 0, 1, or -1 (all)
  retries: number;
  compression?: 'gzip' | 'snappy' | 'lz4' | 'zstd';
  batchSize: number;
  lingerMs: number;       // Time to wait for batching
}

/**
 * Ingestor service configuration (loaded from environment variables)
 */
export interface IngestorConfig {
  tcp: TcpServerConfig;
  kafka: KafkaConfig;
  metrics: {
    enabled: boolean;
    port: number;
    path: string;
  };
  validation: {
    strictMode: boolean;          // Reject messages with any validation errors
    maxPriceDeviation: number;    // Maximum price change percentage to accept
    maxTimestampAge: number;      // Maximum age of timestamps in milliseconds
  };
}

/**
 * Client connection metadata
 */
export interface ClientConnection {
  id: string;
  socket: any;              // Node.js Socket type
  connectedAt: number;
  lastMessageAt?: number;
  messageCount: number;
  remoteAddress?: string;
  remotePort?: number;
}

/**
 * Service metrics for monitoring
 */
export interface ServiceMetrics {
  // Connection metrics
  activeConnections: number;
  totalConnections: number;
  
  // Message processing metrics
  messagesReceived: number;
  messagesProcessed: number;
  messagesFailed: number;
  
  // Kafka metrics
  messagesPublished: number;
  publishErrors: number;
  
  // Performance metrics
  averageProcessingTime: number;
  averageLatency: number;
  
  // Error tracking
  validationErrors: { [errorType: string]: number };
  lastError?: {
    message: string;
    timestamp: number;
    type: string;
  };
}

/**
 * Error types for better error handling and monitoring
 */
export enum ErrorType {
  TCP_CONNECTION_ERROR = 'TCP_CONNECTION_ERROR',
  MESSAGE_PARSE_ERROR = 'MESSAGE_PARSE_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  KAFKA_PUBLISH_ERROR = 'KAFKA_PUBLISH_ERROR',
  KAFKA_CONNECTION_ERROR = 'KAFKA_CONNECTION_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

/**
 * Custom error class for ingestor-specific errors
 */
export class IngestorError extends Error {
  public readonly type: ErrorType;
  public readonly context?: any;
  public readonly timestamp: number;

  constructor(type: ErrorType, message: string, context?: any) {
    super(message);
    this.name = 'IngestorError';
    this.type = type;
    this.context = context;
    this.timestamp = Date.now();
  }
}
