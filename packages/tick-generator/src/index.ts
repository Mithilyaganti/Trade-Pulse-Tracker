#!/usr/bin/env node

import { Command } from 'commander';
import { DataSource, TickGeneratorOptions, TcpSenderConfig, CsvReplayConfig, BinanceRelayConfig } from './types';
import { TcpSender } from './tcp-sender';
import { CsvReplay } from './csv-replay';
import { BinanceRelay } from './binance-relay';

/**
 * Tick Generator - Phase 3 of Trade Pulse Tracker
 * 
 * A flexible financial price tick generator that supports:
 * - CSV file replay with configurable speed and looping
 * - Live Binance WebSocket data relay
 * - TCP delivery to ingestor services
 * - Graceful error handling and reconnection logic
 */
class TickGenerator {
  private tcpSender: TcpSender;
  private csvReplay: CsvReplay | null = null;
  private binanceRelay: BinanceRelay | null = null;
  private options: TickGeneratorOptions;

  constructor(options: TickGeneratorOptions) {
    this.options = options;

    // Initialize TCP sender with configuration
    const tcpConfig: TcpSenderConfig = {
      host: options.host || 'localhost',
      port: options.port || 8080,
      reconnectInterval: options.reconnectInterval || 5000,
      maxReconnectAttempts: options.maxReconnectAttempts || 10
    };

    this.tcpSender = new TcpSender(tcpConfig);
  }

  /**
   * Start the tick generator
   */
  async start(): Promise<void> {
    console.log('🚀 Trade Pulse Tracker - Tick Generator v1.0.0');
    console.log('================================================');
    console.log(`📡 Data Source: ${this.options.source.toUpperCase()}`);
    console.log(`🎯 Target: ${this.options.host}:${this.options.port}`);
    console.log('');

    try {
      // Establish TCP connection
      console.log('🔌 Initializing TCP connection...');
      await this.tcpSender.connect();

      // Start the appropriate data source
      switch (this.options.source) {
        case DataSource.CSV:
          await this.startCsvReplay();
          break;
        case DataSource.BINANCE:
          await this.startBinanceRelay();
          break;
        default:
          throw new Error(`Unsupported data source: ${this.options.source}`);
      }

    } catch (error) {
      console.error('❌ Failed to start tick generator:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the tick generator gracefully
   */
  async stop(): Promise<void> {
    console.log('🛑 Shutting down tick generator...');

    // Stop data sources
    if (this.csvReplay) {
      this.csvReplay.stop();
    }
    if (this.binanceRelay) {
      this.binanceRelay.stop();
    }

    // Close TCP connection
    await this.tcpSender.disconnect();

    console.log('✅ Tick generator stopped gracefully');
  }

  /**
   * Start CSV replay functionality
   */
  private async startCsvReplay(): Promise<void> {
    if (!this.options.file) {
      throw new Error('CSV file path is required for CSV replay mode');
    }

    const csvConfig: CsvReplayConfig = {
      filePath: this.options.file,
      speedMultiplier: this.options.speed || 1.0,
      loop: this.options.loop || false
    };

    this.csvReplay = new CsvReplay(csvConfig, this.tcpSender);
    
    console.log('📁 Starting CSV replay...');
    await this.csvReplay.start();
  }

  /**
   * Start Binance WebSocket relay
   */
  private async startBinanceRelay(): Promise<void> {
    if (!this.options.symbols || this.options.symbols.length === 0) {
      throw new Error('At least one symbol is required for Binance relay mode');
    }

    const binanceConfig: BinanceRelayConfig = {
      symbols: this.options.symbols,
      baseUrl: 'wss://stream.binance.com:9443'
    };

    this.binanceRelay = new BinanceRelay(binanceConfig, this.tcpSender);
    
    console.log('🌐 Starting Binance WebSocket relay...');
    await this.binanceRelay.start();
  }

  /**
   * Get current status information
   */
  getStatus(): any {
    const baseStatus = {
      source: this.options.source,
      tcpConnection: this.tcpSender.isConnectionActive(),
      queuedMessages: this.tcpSender.getQueuedMessageCount()
    };

    if (this.csvReplay) {
      return { ...baseStatus, csv: this.csvReplay.getStatus() };
    }

    if (this.binanceRelay) {
      return { ...baseStatus, binance: this.binanceRelay.getStatus() };
    }

    return baseStatus;
  }
}

/**
 * Command line interface setup
 */
function setupCLI(): void {
  const program = new Command();

  program
    .name('tick-generator')
    .description('Financial price tick generator with CSV replay and Binance WebSocket relay')
    .version('1.0.0');

  program
    .requiredOption('-s, --source <type>', 'data source type (csv or binance)', (value) => {
      if (!Object.values(DataSource).includes(value as DataSource)) {
        throw new Error(`Invalid source type: ${value}. Must be one of: ${Object.values(DataSource).join(', ')}`);
      }
      return value as DataSource;
    })
    .option('-f, --file <path>', 'CSV file path (required for csv source)')
    .option('-y, --symbols <symbols>', 'comma-separated Binance symbols (required for binance source)', (value) => {
      return value.split(',').map(s => s.trim().toUpperCase());
    })
    .option('-x, --speed <multiplier>', 'playback speed multiplier for CSV (default: 1.0)', parseFloat, 1.0)
    .option('-l, --loop', 'loop CSV playback when file ends', false)
    .option('-h, --host <host>', 'TCP target host (default: localhost)', 'localhost')
    .option('-p, --port <port>', 'TCP target port (default: 8080)', (value) => parseInt(value), 8080)
    .option('-r, --reconnect-interval <ms>', 'TCP reconnection interval in ms (default: 5000)', (value) => parseInt(value), 5000)
    .option('-m, --max-reconnect-attempts <count>', 'maximum TCP reconnection attempts (default: 10)', (value) => parseInt(value), 10);

  program.parse();

  const options = program.opts() as TickGeneratorOptions;

  // Validate source-specific options
  if (options.source === DataSource.CSV && !options.file) {
    console.error('❌ Error: --file is required when using CSV source');
    process.exit(1);
  }

  if (options.source === DataSource.BINANCE && (!options.symbols || options.symbols.length === 0)) {
    console.error('❌ Error: --symbols is required when using Binance source');
    process.exit(1);
  }

  // Start the tick generator
  const generator = new TickGenerator(options);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    await generator.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    await generator.stop();
    process.exit(0);
  });

  // Start the generator
  generator.start().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  });
}

// Only run CLI if this file is executed directly
if (require.main === module) {
  setupCLI();
}

export { TickGenerator };
export * from './types';
