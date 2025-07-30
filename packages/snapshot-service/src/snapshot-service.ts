/**
 * Main Snapshot Service Orchestrator
 * Coordinates Kafka consumer, PostgreSQL updater, REST API, and WebSocket server
 */

import { register } from 'prom-client';
import { KafkaConsumerService } from './kafka-consumer';
import { PostgresUpdaterService } from './postgres-updater';
import { RestApiService } from './rest-api';
import { WebSocketServerService } from './websocket-server';
import { SnapshotServiceConfig, PriceTick, ServiceMetrics, PriceSnapshot } from './types';

export class SnapshotService {
  private config: SnapshotServiceConfig;
  private kafkaConsumer: KafkaConsumerService;
  private postgresUpdater: PostgresUpdaterService;
  private restApi: RestApiService;
  private websocketServer: WebSocketServerService;
  private isRunning = false;
  private startTime: number;
  private metrics: ServiceMetrics;

  constructor(config: SnapshotServiceConfig) {
    this.config = config;
    this.startTime = Date.now();
    
    // Initialize metrics
    this.metrics = {
      kafkaMessagesProcessed: 0,
      kafkaMessagesError: 0,
      databaseOperationsSuccess: 0,
      databaseOperationsError: 0,
      websocketConnections: 0,
      websocketMessagesOut: 0,
      restApiRequests: 0,
      restApiErrors: 0,
      uptime: 0
    };

    // Initialize services
    this.postgresUpdater = new PostgresUpdaterService(config);
    this.kafkaConsumer = new KafkaConsumerService(config);
    this.restApi = new RestApiService(config, this.postgresUpdater);
    this.websocketServer = new WebSocketServerService(config, this.postgresUpdater);

    // Set up Kafka message handler
    this.kafkaConsumer.setMessageHandler(this.handlePriceTick.bind(this));

    // Set up graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Handle incoming price tick from Kafka
   */
  private async handlePriceTick(tick: PriceTick): Promise<void> {
    try {
      // Update metrics
      this.metrics.kafkaMessagesProcessed++;

      // Process tick in database
      await this.postgresUpdater.addToBatch(tick);
      this.metrics.databaseOperationsSuccess++;

      // Convert to snapshot format for broadcasting
      const snapshot: PriceSnapshot = {
        symbol: this.cleanSymbol(tick.ric),
        price: tick.price,
        timestamp: tick.timestamp
      };
      
      if (tick.volume !== undefined) {
        snapshot.volume = tick.volume;
      }

      // Broadcast to WebSocket clients
      this.websocketServer.broadcastPriceUpdate(snapshot);
      this.metrics.websocketMessagesOut++;

      // Log processing for development
      if (process.env.NODE_ENV === 'development') {
        console.log(`Processed tick: ${tick.ric} @ ${tick.price}`);
      }

    } catch (error) {
      console.error('Error handling price tick:', error);
      this.metrics.kafkaMessagesError++;
      this.metrics.databaseOperationsError++;
    }
  }

  /**
   * Clean symbol by removing RIC suffixes
   */
  private cleanSymbol(ric: string): string {
    return ric.replace(/\.[A-Z]+$/, '').toUpperCase();
  }

  /**
   * Start all services
   */
  public async start(): Promise<void> {
    try {
      console.log('Starting Trade Pulse Snapshot Service...');
      
      // Start PostgreSQL connection
      console.log('Initializing PostgreSQL connection...');
      await this.postgresUpdater.initialize();
      
      // Start REST API
      console.log('Starting REST API server...');
      await this.restApi.start();
      
      // WebSocket server starts automatically in constructor
      console.log('WebSocket server ready');
      
      // Start Kafka consumer (should be last)
      console.log('Starting Kafka consumer...');
      await this.kafkaConsumer.connect();
      
      this.isRunning = true;
      console.log('✅ Snapshot Service started successfully');
      console.log(`📊 REST API: http://${this.config.restApiHost}:${this.config.restApiPort}`);
      console.log(`🔌 WebSocket: ws://${this.config.websocketHost}:${this.config.websocketPort}`);
      console.log(`📈 Metrics: http://${this.config.restApiHost}:${this.config.metricsPort}${this.config.metricsPath}`);
      
    } catch (error) {
      console.error('Failed to start Snapshot Service:', error);
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Shutdown all services gracefully
   */
  public async shutdown(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('Shutting down Snapshot Service...');
    this.isRunning = false;

    try {
      // Stop Kafka consumer first to prevent new messages
      console.log('Stopping Kafka consumer...');
      await this.kafkaConsumer.disconnect();

      // Stop WebSocket server
      console.log('Stopping WebSocket server...');
      await this.websocketServer.shutdown();

      // Stop REST API
      console.log('Stopping REST API server...');
      await this.restApi.stop();

      // Shutdown PostgreSQL connections last
      console.log('Shutting down PostgreSQL connections...');
      await this.postgresUpdater.shutdown();

      console.log('✅ Snapshot Service shutdown complete');
    } catch (error) {
      console.error('Error during shutdown:', error);
      throw error;
    }
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      console.log(`\nReceived ${signal}, initiating graceful shutdown...`);
      try {
        await this.shutdown();
        process.exit(0);
      } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled Rejection at:', promise, 'reason:', reason);
      gracefulShutdown('unhandledRejection');
    });
  }

  /**
   * Get service health status
   */
  public getHealthStatus() {
    const uptime = Date.now() - this.startTime;
    this.metrics.uptime = uptime;

    return {
      status: this.isRunning ? 'running' : 'stopped',
      uptime,
      services: {
        kafka: this.kafkaConsumer.getConnectionStatus(),
        database: this.postgresUpdater.getConnectionStatus(),
        restApi: true, // REST API health is checked via endpoint
        websocket: true // WebSocket health is checked via stats
      },
      metrics: this.metrics,
      clients: this.websocketServer.getStats(),
      timestamp: Date.now()
    };
  }

  /**
   * Get detailed service statistics
   */
  public async getDetailedStats() {
    const health = this.getHealthStatus();
    const dbStats = await this.postgresUpdater.getStatistics();
    const wsStats = this.websocketServer.getStats();
    const restStats = this.restApi.getServerStats();

    return {
      service: health,
      database: dbStats,
      websocket: wsStats,
      restApi: restStats,
      clients: this.websocketServer.getClientInfo(),
      timestamp: Date.now()
    };
  }

  /**
   * Pause message processing
   */
  public async pause(): Promise<void> {
    console.log('Pausing message processing...');
    await this.kafkaConsumer.pause();
  }

  /**
   * Resume message processing
   */
  public async resume(): Promise<void> {
    console.log('Resuming message processing...');
    await this.kafkaConsumer.resume();
  }

  /**
   * Get Prometheus metrics
   */
  public async getPrometheusMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Check if service is running
   */
  public isServiceRunning(): boolean {
    return this.isRunning;
  }
}
