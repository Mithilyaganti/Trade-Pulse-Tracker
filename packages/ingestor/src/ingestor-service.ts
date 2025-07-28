import { TcpServer } from './tcp-server';
import { MessageValidator } from './message-validator';
import { KafkaPublisher } from './kafka-publisher';
import { MetricsExporter } from './metrics-exporter';
import { 
  IngestorConfig, 
  RawMessage, 
  EnrichedTick, 
  ServiceMetrics, 
  ErrorType, 
  IngestorError 
} from './types';

/**
 * Main ingestor service that orchestrates TCP message reception,
 * validation, enrichment, and Kafka publishing
 */
export class IngestorService {
  private config: IngestorConfig;
  private tcpServer: TcpServer;
  private validator: MessageValidator;
  private kafkaPublisher: KafkaPublisher;
  private metricsExporter: MetricsExporter;

  // Service state
  private isRunning = false;
  private sequenceCounter = 0;
  private startTime = Date.now();

  // Service metrics
  private metrics: ServiceMetrics = {
    activeConnections: 0,
    totalConnections: 0,
    messagesReceived: 0,
    messagesProcessed: 0,
    messagesFailed: 0,
    messagesPublished: 0,
    publishErrors: 0,
    averageProcessingTime: 0,
    averageLatency: 0,
    validationErrors: {}
  };

  constructor(config: IngestorConfig) {
    this.config = config;

    // Initialize components
    this.tcpServer = new TcpServer(config.tcp);
    this.validator = new MessageValidator(config);
    this.kafkaPublisher = new KafkaPublisher(config.kafka);
    this.metricsExporter = new MetricsExporter(config.metrics);

    // Set up message handler
    this.tcpServer.setMessageHandler(this.handleMessage.bind(this));

    // Set up graceful shutdown handlers
    this.setupGracefulShutdown();
  }

  /**
   * Start the ingestor service
   */
  async start(): Promise<void> {
    try {
      console.log('🚀 Starting Trade Pulse Ingestor Service...');

      // Start Kafka publisher first
      console.log('📡 Connecting to Kafka...');
      await this.kafkaPublisher.connect();

      // Start metrics exporter
      console.log('📊 Starting metrics exporter...');
      await this.metricsExporter.start();

      // Start TCP server
      console.log('🔌 Starting TCP server...');
      await this.tcpServer.start();

      this.isRunning = true;
      console.log('✅ Ingestor service started successfully');
      console.log(`📋 Configuration:`);
      console.log(`   TCP: ${this.config.tcp.host}:${this.config.tcp.port}`);
      console.log(`   Kafka: ${this.config.kafka.brokers.join(', ')} -> ${this.config.kafka.topic}`);
      console.log(`   Metrics: ${this.config.metrics.enabled ? `enabled on port ${this.config.metrics.port}` : 'disabled'}`);
      
      // Start periodic metrics reporting
      this.startMetricsReporting();

    } catch (error) {
      console.error('❌ Failed to start ingestor service:', error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  /**
   * Stop the ingestor service gracefully
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    console.log('🛑 Stopping ingestor service...');
    this.isRunning = false;

    try {
      // Stop accepting new connections
      await this.tcpServer.stop();

      // Shutdown Kafka publisher (will flush pending messages)
      await this.kafkaPublisher.shutdown();

      // Stop metrics exporter
      await this.metricsExporter.stop();

      console.log('✅ Ingestor service stopped gracefully');
      this.logFinalMetrics();

    } catch (error) {
      console.error('❌ Error during shutdown:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Handle incoming raw messages from TCP clients
   */
  private async handleMessage(rawMessage: RawMessage): Promise<void> {
    const startTime = process.hrtime.bigint();
    
    try {
      // Update metrics
      this.metrics.messagesReceived++;
      this.metricsExporter.recordMessageReceived(rawMessage.clientId);

      // Validate the message
      const validationResult = this.validator.validateMessage(rawMessage.data);

      if (!validationResult.isValid || !validationResult.tick) {
        // Handle validation failure
        this.handleValidationFailure(rawMessage, validationResult.errors);
        return;
      }

      // Enrich the tick with server metadata
      const enrichedTick = this.enrichTick(validationResult.tick, rawMessage);

      // Publish to Kafka
      await this.kafkaPublisher.publishTick(enrichedTick);

      // Update success metrics
      this.metrics.messagesProcessed++;
      this.metrics.messagesPublished++;
      this.metricsExporter.recordMessageProcessed('success');
      this.metricsExporter.recordMessagePublished(this.config.kafka.topic);

      // Calculate and record processing time
      const endTime = process.hrtime.bigint();
      const processingTimeNs = Number(endTime - startTime);
      const processingTimeMs = processingTimeNs / 1_000_000;
      const processingTimeSeconds = processingTimeNs / 1_000_000_000;

      this.updateProcessingMetrics(processingTimeMs);
      this.metricsExporter.recordProcessingTime(processingTimeSeconds);

      // Log periodic progress
      if (this.metrics.messagesProcessed % 100 === 0) {
        console.log(`📈 Processed ${this.metrics.messagesProcessed} messages (avg: ${this.metrics.averageProcessingTime.toFixed(2)}ms)`);
      }

    } catch (error) {
      this.handleProcessingError(rawMessage, error);
    }
  }

  /**
   * Enrich tick data with server-side metadata
   */
  private enrichTick(tick: any, rawMessage: RawMessage): EnrichedTick {
    this.sequenceCounter++;
    
    const enrichedTick: EnrichedTick = {
      ...tick,
      receivedAt: rawMessage.receivedAt,
      clientId: rawMessage.clientId,
      sequenceId: `${Date.now()}-${this.sequenceCounter}`,
      validationPassed: true,
      validationErrors: []
    };

    // Calculate latency (difference between tick timestamp and received timestamp)
    if (tick.timestamp) {
      enrichedTick.latencyMs = rawMessage.receivedAt - tick.timestamp;
    }

    return enrichedTick;
  }

  /**
   * Handle validation failures
   */
  private handleValidationFailure(rawMessage: RawMessage, errors: string[]): void {
    this.metrics.messagesFailed++;
    this.metricsExporter.recordMessageFailed('validation_error');
    this.metricsExporter.recordMessageProcessed('failed');

    // Update validation error counts
    errors.forEach(error => {
      const errorType = this.categorizeValidationError(error);
      this.metrics.validationErrors[errorType] = (this.metrics.validationErrors[errorType] || 0) + 1;
      this.metricsExporter.recordValidationError(errorType);
    });

    // Log validation errors (rate-limited)
    if (this.metrics.messagesFailed % 10 === 1) {
      console.warn(`⚠️  Validation failed for client ${rawMessage.clientId}:`, errors.join('; '));
      console.warn(`   Raw message: ${rawMessage.data.substring(0, 100)}...`);
    }
  }

  /**
   * Handle processing errors
   */
  private handleProcessingError(rawMessage: RawMessage, error: any): void {
    this.metrics.messagesFailed++;
    this.metricsExporter.recordMessageFailed('processing_error');
    this.metricsExporter.recordMessageProcessed('failed');

    if (error instanceof IngestorError && error.type === ErrorType.KAFKA_PUBLISH_ERROR) {
      this.metrics.publishErrors++;
      this.metricsExporter.recordPublishError(error.type);
    }

    console.error(`❌ Processing error for client ${rawMessage.clientId}:`, error instanceof Error ? error.message : 'Unknown error');
    
    // Update last error for monitoring
    this.metrics.lastError = {
      message: error instanceof Error ? error.message : 'Unknown error',
      timestamp: Date.now(),
      type: error instanceof IngestorError ? error.type : ErrorType.INTERNAL_ERROR
    };
  }

  /**
   * Categorize validation errors for metrics
   */
  private categorizeValidationError(error: string): string {
    if (error.includes('RIC')) return 'invalid_ric';
    if (error.includes('price')) return 'invalid_price';
    if (error.includes('timestamp')) return 'invalid_timestamp';
    if (error.includes('format')) return 'invalid_format';
    if (error.includes('deviation')) return 'price_deviation';
    if (error.includes('bid/ask')) return 'invalid_spread';
    return 'other';
  }

  /**
   * Update processing time metrics
   */
  private updateProcessingMetrics(processingTimeMs: number): void {
    // Calculate rolling average processing time
    const totalMessages = this.metrics.messagesProcessed;
    if (totalMessages === 1) {
      this.metrics.averageProcessingTime = processingTimeMs;
    } else {
      // Exponential moving average with alpha = 0.1
      this.metrics.averageProcessingTime = 
        0.9 * this.metrics.averageProcessingTime + 0.1 * processingTimeMs;
    }
  }

  /**
   * Start periodic metrics reporting
   */
  private startMetricsReporting(): void {
    const reportInterval = 30000; // 30 seconds

    const report = () => {
      if (!this.isRunning) return;

      // Update metrics from components
      const tcpMetrics = this.tcpServer.getMetrics();
      const kafkaMetrics = this.kafkaPublisher.getMetrics();

      this.metrics.activeConnections = tcpMetrics.activeConnections || 0;
      this.metrics.totalConnections = tcpMetrics.totalConnections || 0;
      this.metrics.messagesReceived = tcpMetrics.messagesReceived || 0;
      this.metrics.messagesPublished = kafkaMetrics.messagesPublished || 0;
      this.metrics.publishErrors = kafkaMetrics.publishErrors || 0;

      // Update Prometheus metrics
      this.metricsExporter.updateActiveConnections(this.metrics.activeConnections);

      // Log periodic status report
      const uptime = Math.round((Date.now() - this.startTime) / 1000);
      const messagesPerSecond = uptime > 0 ? (this.metrics.messagesProcessed / uptime).toFixed(2) : '0';

      console.log(`📊 Status Report (uptime: ${uptime}s):`);
      console.log(`   Active connections: ${this.metrics.activeConnections}`);
      console.log(`   Messages: received=${this.metrics.messagesReceived}, processed=${this.metrics.messagesProcessed}, failed=${this.metrics.messagesFailed}`);
      console.log(`   Throughput: ${messagesPerSecond} msg/s, avg processing: ${this.metrics.averageProcessingTime.toFixed(2)}ms`);
      console.log(`   Kafka: published=${this.metrics.messagesPublished}, errors=${this.metrics.publishErrors}`);

      // Schedule next report
      setTimeout(report, reportInterval);
    };

    // Start reporting after initial delay
    setTimeout(report, reportInterval);
  }

  /**
   * Set up graceful shutdown handlers
   */
  private setupGracefulShutdown(): void {
    const signals = ['SIGINT', 'SIGTERM'];

    signals.forEach(signal => {
      process.on(signal, async () => {
        console.log(`\n🛑 Received ${signal}, shutting down gracefully...`);
        await this.stop();
        process.exit(0);
      });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('💥 Uncaught exception:', error);
      this.stop().finally(() => process.exit(1));
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('💥 Unhandled rejection at:', promise, 'reason:', reason);
      this.stop().finally(() => process.exit(1));
    });
  }

  /**
   * Log final metrics on shutdown
   */
  private logFinalMetrics(): void {
    const uptime = Math.round((Date.now() - this.startTime) / 1000);
    
    console.log('\n📊 Final Service Metrics:');
    console.log(`   Uptime: ${uptime} seconds`);
    console.log(`   Total connections: ${this.metrics.totalConnections}`);
    console.log(`   Messages received: ${this.metrics.messagesReceived}`);
    console.log(`   Messages processed: ${this.metrics.messagesProcessed}`);
    console.log(`   Messages failed: ${this.metrics.messagesFailed}`);
    console.log(`   Messages published: ${this.metrics.messagesPublished}`);
    console.log(`   Publish errors: ${this.metrics.publishErrors}`);
    console.log(`   Average processing time: ${this.metrics.averageProcessingTime.toFixed(2)}ms`);
    
    if (Object.keys(this.metrics.validationErrors).length > 0) {
      console.log('   Validation errors:');
      Object.entries(this.metrics.validationErrors).forEach(([type, count]) => {
        console.log(`     ${type}: ${count}`);
      });
    }
  }

  /**
   * Get current service metrics (for health checks or external monitoring)
   */
  getMetrics(): ServiceMetrics {
    return { ...this.metrics };
  }

  /**
   * Check if service is healthy
   */
  isHealthy(): boolean {
    return this.isRunning && 
           this.tcpServer.isServerListening() && 
           this.kafkaPublisher.isConnectedToKafka();
  }
}
