/**
 * Price tick data structure following RIC (Reuters Instrument Code) format
 * This represents a single price update for a financial instrument
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
 * Configuration for CSV replay functionality
 */
export interface CsvReplayConfig {
  filePath: string;
  speedMultiplier: number;  // 1.0 = real-time, 2.0 = 2x speed, etc.
  loop: boolean;           // Whether to restart from beginning when file ends
}

/**
 * Configuration for Binance WebSocket relay
 */
export interface BinanceRelayConfig {
  symbols: string[];       // Trading symbols to subscribe to (e.g., ["BTCUSDT", "ETHUSDT"])
  baseUrl: string;        // Binance WebSocket base URL
}

/**
 * TCP sender configuration
 */
export interface TcpSenderConfig {
  host: string;
  port: number;
  reconnectInterval: number;  // Milliseconds between reconnection attempts
  maxReconnectAttempts: number;
}

/**
 * Binance WebSocket tick data structure
 */
export interface BinanceTick {
  e: string;    // Event type
  E: number;    // Event time
  s: string;    // Symbol
  c: string;    // Close price
  o: string;    // Open price
  h: string;    // High price
  l: string;    // Low price
  v: string;    // Total traded base asset volume
  q: string;    // Total traded quote asset volume
}

/**
 * CSV row structure for Stooq format
 */
export interface StooqCsvRow {
  Date: string;      // YYYY-MM-DD
  Time: string;      // HH:mm:ss
  Open: string;      // Opening price
  High: string;      // Highest price
  Low: string;       // Lowest price
  Close: string;     // Closing price
  Volume: string;    // Trading volume
}

/**
 * Data source types supported by the tick generator
 */
export enum DataSource {
  CSV = 'csv',
  BINANCE = 'binance'
}

/**
 * Tick generator options from command line
 */
export interface TickGeneratorOptions {
  source: DataSource;
  file?: string;              // CSV file path (for CSV source)
  symbols?: string[];         // Binance symbols (for Binance source)
  speed?: number;             // Speed multiplier for CSV replay
  loop?: boolean;             // Loop CSV replay
  host?: string;              // TCP target host
  port?: number;              // TCP target port
  reconnectInterval?: number; // TCP reconnection interval
  maxReconnectAttempts?: number; // Max TCP reconnection attempts
}
