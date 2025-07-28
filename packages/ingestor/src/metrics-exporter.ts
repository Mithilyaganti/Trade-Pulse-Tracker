import { register, collectDefaultMetrics, Counter, Gauge, Histogram } from 'prom-client';
import * as http from 'http';
import { ServiceMetrics, IngestorConfig } from './types';

/**
 * Prometheus metrics exporter for monitoring the ingestor service
 * Exposes HTTP endpoint for Prometheus scraping
 */
export class MetricsExporter {
  private server: http.Server;
  private config: IngestorConfig['metrics'];
  
  // Prometheus metrics
  private readonly connectionsTotal: Counter<string>;
  private readonly activeConnections: Gauge<string>;
  private readonly messagesReceived: Counter<string>;
  private readonly messagesProcessed: Counter<string>;
  private readonly messagesFailed: Counter<string>;
  private readonly messagesPublished: Counter<string>;
  private readonly publishErrors: Counter<string>;
  private readonly processingDuration: Histogram<string>;
  private readonly validationErrors: Counter<string>;

  constructor(config: IngestorConfig['metrics']) {
    this.config = config;

    // Enable default metrics (CPU, memory, etc.)
    if (config.enabled) {
      collectDefaultMetrics({
        prefix: 'ingestor_',
        register
      });
    }

    // Initialize custom metrics
    this.connectionsTotal = new Counter({
      name: 'ingestor_connections_total',
      help: 'Total number of TCP connections received',
      labelNames: ['status'] as const
    });

    this.activeConnections = new Gauge({
      name: 'ingestor_active_connections',
      help: 'Current number of active TCP connections'
    });

    this.messagesReceived = new Counter({
      name: 'ingestor_messages_received_total',
      help: 'Total number of messages received via TCP',
      labelNames: ['client_id'] as const
    });

    this.messagesProcessed = new Counter({
      name: 'ingestor_messages_processed_total',
      help: 'Total number of messages successfully processed',
      labelNames: ['status'] as const
    });

    this.messagesFailed = new Counter({
      name: 'ingestor_messages_failed_total',
      help: 'Total number of messages that failed processing',
      labelNames: ['reason'] as const
    });

    this.messagesPublished = new Counter({
      name: 'ingestor_messages_published_total',
      help: 'Total number of messages published to Kafka',
      labelNames: ['topic'] as const
    });

    this.publishErrors = new Counter({
      name: 'ingestor_publish_errors_total',
      help: 'Total number of Kafka publish errors',
      labelNames: ['error_type'] as const
    });

    this.processingDuration = new Histogram({
      name: 'ingestor_processing_duration_seconds',
      help: 'Time spent processing messages',
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
    });

    this.validationErrors = new Counter({
      name: 'ingestor_validation_errors_total',
      help: 'Total number of message validation errors',
      labelNames: ['error_type'] as const
    });

    // Create HTTP server for metrics endpoint
    this.server = http.createServer((req, res) => {
      if (req.url === this.config.path && req.method === 'GET') {
        this.handleMetricsRequest(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });
  }

  /**
   * Handle Prometheus metrics requests
   */
  private async handleMetricsRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      res.writeHead(200, { 'Content-Type': register.contentType });
      res.end(await register.metrics());
    } catch (error) {
      console.error('❌ Error generating metrics:', error instanceof Error ? error.message : 'Unknown error');
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }

  /**
   * Start the metrics server
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('📊 Metrics collection disabled');
      return;
    }

    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, () => {
        console.log(`📊 Metrics server listening on port ${this.config.port}${this.config.path}`);
        resolve();
      });

      this.server.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Stop the metrics server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('📊 Metrics server stopped');
        resolve();
      });
    });
  }

  /**
   * Record a new connection
   */
  recordConnection(status: 'connected' | 'disconnected'): void {
    if (this.config.enabled) {
      this.connectionsTotal.inc({ status });
    }
  }

  /**
   * Update active connections count
   */
  updateActiveConnections(count: number): void {
    if (this.config.enabled) {
      this.activeConnections.set(count);
    }
  }

  /**
   * Record a received message
   */
  recordMessageReceived(clientId: string): void {
    if (this.config.enabled) {
      this.messagesReceived.inc({ client_id: clientId });
    }
  }

  /**
   * Record a processed message
   */
  recordMessageProcessed(status: 'success' | 'failed'): void {
    if (this.config.enabled) {
      this.messagesProcessed.inc({ status });
    }
  }

  /**
   * Record a failed message
   */
  recordMessageFailed(reason: string): void {
    if (this.config.enabled) {
      this.messagesFailed.inc({ reason });
    }
  }

  /**
   * Record a published message
   */
  recordMessagePublished(topic: string): void {
    if (this.config.enabled) {
      this.messagesPublished.inc({ topic });
    }
  }

  /**
   * Record a publish error
   */
  recordPublishError(errorType: string): void {
    if (this.config.enabled) {
      this.publishErrors.inc({ error_type: errorType });
    }
  }

  /**
   * Record processing duration
   */
  recordProcessingTime(durationSeconds: number): void {
    if (this.config.enabled) {
      this.processingDuration.observe(durationSeconds);
    }
  }

  /**
   * Record a validation error
   */
  recordValidationError(errorType: string): void {
    if (this.config.enabled) {
      this.validationErrors.inc({ error_type: errorType });
    }
  }

  /**
   * Update metrics from service metrics object
   */
  updateFromServiceMetrics(metrics: ServiceMetrics): void {
    if (!this.config.enabled) {
      return;
    }

    this.updateActiveConnections(metrics.activeConnections);

    // Note: Counters can only be incremented, not set to absolute values
    // So we only record deltas, not absolute values for counters
  }

  /**
   * Get current metrics as text (for debugging)
   */
  async getMetricsText(): Promise<string> {
    if (!this.config.enabled) {
      return 'Metrics collection disabled';
    }

    try {
      return await register.metrics();
    } catch (error) {
      return `Error generating metrics: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clearMetrics(): void {
    if (this.config.enabled) {
      register.clear();
    }
  }
}
