import { Kafka, Producer, KafkaMessage, logLevel, CompressionTypes } from 'kafkajs';
import { EnrichedTick, KafkaConfig, ServiceMetrics, ErrorType, IngestorError } from './types';

/**
 * Kafka publisher for sending validated price ticks to the message queue
 * Handles connection management, batching, retries, and error recovery
 */
export class KafkaPublisher {
  private kafka: Kafka;
  private producer: Producer;
  private config: KafkaConfig;
  private isConnected = false;
  private publishCount = 0;
  private errorCount = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(config: KafkaConfig) {
    this.config = config;
    
    // Initialize Kafka client with custom configuration
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      logLevel: logLevel.WARN, // Reduce log noise in production
      retry: {
        initialRetryTime: 1000,
        retries: config.retries,
        maxRetryTime: 30000,
        multiplier: 2,
        restartOnFailure: async (error) => {
          console.error('🔄 Kafka restarting due to error:', error.message);
          return true;
        }
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

        // Create Kafka producer with proper configuration
    this.producer = this.kafka.producer({
      transactionTimeout: 5000,
      maxInFlightRequests: 1, // Must be 1 when idempotent is false
      idempotent: false, // Disable idempotent producer to allow different ack settings
      allowAutoTopicCreation: true,
    });

    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for monitoring and error handling
   */
  private setupEventHandlers(): void {
    // Connection events
    this.producer.on('producer.connect', () => {
      console.log('✅ Kafka producer connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.producer.on('producer.disconnect', () => {
      console.log('🔌 Kafka producer disconnected');
      this.isConnected = false;
    });

    // Network events
    this.producer.on('producer.network.request', (event) => {
      // Log only errors and important events to avoid noise
      if ((event.payload as any).error) {
        console.error('❌ Kafka network error:', (event.payload as any).error);
      }
    });

    // Error handling
    this.producer.on('producer.network.request_timeout', (event) => {
      console.warn('⏰ Kafka request timeout:', event.payload);
    });

    this.producer.on('producer.network.request_queue_size', (event) => {
      if (event.payload.queueSize > 100) {
        console.warn(`📋 Kafka request queue growing: ${event.payload.queueSize}`);
      }
    });
  }

  /**
   * Initialize connection to Kafka
   */
  async connect(): Promise<void> {
    try {
      console.log(`🔌 Connecting to Kafka brokers: ${this.config.brokers.join(', ')}`);
      await this.producer.connect();
      
      // Test the connection by sending a test message
      await this.testConnection();
      
      console.log('✅ Kafka publisher initialized successfully');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Failed to connect to Kafka:', errorMessage);
      throw new IngestorError(
        ErrorType.KAFKA_CONNECTION_ERROR,
        `Failed to connect to Kafka: ${errorMessage}`,
        { brokers: this.config.brokers, error }
      );
    }
  }

  /**
   * Test Kafka connection by sending a test message
   */
  private async testConnection(): Promise<void> {
    const testMessage: EnrichedTick = {
      ric: 'TEST.CONNECTION',
      price: 1.0,
      timestamp: Date.now(),
      receivedAt: Date.now(),
      clientId: 'connection-test',
      sequenceId: 'test-seq-1',
      validationPassed: true,
      validationErrors: []
    };

    await this.publishTick(testMessage, true);
  }

  /**
   * Publish a validated price tick to Kafka
   */
  async publishTick(tick: EnrichedTick, isTestMessage = false): Promise<void> {
    try {
      if (!this.isConnected) {
        throw new IngestorError(
          ErrorType.KAFKA_CONNECTION_ERROR,
          'Kafka producer is not connected'
        );
      }

      // Prepare the message
      const messageValue = JSON.stringify(tick);
      const messageKey = tick.ric; // Use RIC as partition key for ordering

      const message = {
        key: messageKey,
        value: messageValue,
        timestamp: tick.timestamp.toString(),
        headers: {
          'client-id': tick.clientId,
          'sequence-id': tick.sequenceId,
          'received-at': tick.receivedAt.toString(),
          'validation-passed': tick.validationPassed.toString(),
          'content-type': 'application/json',
          'producer': this.config.clientId
        }
      };

      // Send to Kafka with retry logic
      const result = await this.producer.send({
        topic: this.config.topic,
        messages: [message],
        compression: this.config.compression as unknown as CompressionTypes,
        acks: this.config.acks,
        timeout: 10000,
      });

      // Update metrics
      this.publishCount++;

      if (!isTestMessage) {
        // Log successful publish (rate-limited to avoid spam)
        if (this.publishCount % 100 === 0) {
          console.log(`📤 Published ${this.publishCount} ticks to Kafka (latest: ${tick.ric} @ ${tick.price})`);
        }

        // Log partition information for the first few messages
        if (this.publishCount <= 5) {
          console.log(`📍 Tick published to topic: ${this.config.topic}, partition: ${result[0].partition}, offset: ${result[0].baseOffset}`);
        }
      }

    } catch (error) {
      this.errorCount++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`❌ Failed to publish tick to Kafka: ${errorMessage}`, {
        ric: tick.ric,
        price: tick.price,
        sequenceId: tick.sequenceId,
        error: errorMessage
      });

      // Try to reconnect on connection errors
      if (errorMessage.includes('Connection') || errorMessage.includes('timeout')) {
        await this.handleConnectionError();
      }

      throw new IngestorError(
        ErrorType.KAFKA_PUBLISH_ERROR,
        `Failed to publish tick: ${errorMessage}`,
        { tick, error }
      );
    }
  }

  /**
   * Publish multiple ticks in a batch for better performance
   */
  async publishBatch(ticks: EnrichedTick[]): Promise<void> {
    try {
      if (!this.isConnected) {
        throw new IngestorError(
          ErrorType.KAFKA_CONNECTION_ERROR,
          'Kafka producer is not connected'
        );
      }

      if (ticks.length === 0) {
        return;
      }

      // Prepare batch messages
      const messages = ticks.map(tick => ({
        key: tick.ric,
        value: JSON.stringify(tick),
        timestamp: tick.timestamp.toString(),
        headers: {
          'client-id': tick.clientId,
          'sequence-id': tick.sequenceId,
          'received-at': tick.receivedAt.toString(),
          'validation-passed': tick.validationPassed.toString(),
          'content-type': 'application/json',
          'producer': this.config.clientId
        }
      }));

      // Send batch to Kafka
      const result = await this.producer.send({
        topic: this.config.topic,
        messages,
        compression: this.config.compression as any,
        acks: this.config.acks,
        timeout: 15000,
      });

      // Update metrics
      this.publishCount += ticks.length;

      console.log(`📦 Published batch of ${ticks.length} ticks to Kafka (total: ${this.publishCount})`);

    } catch (error) {
      this.errorCount += ticks.length;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      console.error(`❌ Failed to publish batch to Kafka: ${errorMessage}`, {
        batchSize: ticks.length,
        error: errorMessage
      });

      throw new IngestorError(
        ErrorType.KAFKA_PUBLISH_ERROR,
        `Failed to publish batch: ${errorMessage}`,
        { batchSize: ticks.length, error }
      );
    }
  }

  /**
   * Handle connection errors with automatic reconnection
   */
  private async handleConnectionError(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    
    console.log(`🔄 Attempting to reconnect to Kafka (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    try {
      await this.producer.disconnect();
      await this.producer.connect();
    } catch (error) {
      console.error('❌ Reconnection failed:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Get publisher metrics for monitoring
   */
  getMetrics(): Partial<ServiceMetrics> {
    return {
      messagesPublished: this.publishCount,
      publishErrors: this.errorCount,
    };
  }

  /**
   * Get connection status
   */
  isConnectedToKafka(): boolean {
    return this.isConnected;
  }

  /**
   * Gracefully disconnect from Kafka
   */
  async disconnect(): Promise<void> {
    try {
      console.log('🔌 Disconnecting from Kafka...');
      await this.producer.disconnect();
      this.isConnected = false;
      console.log('✅ Kafka producer disconnected gracefully');
    } catch (error) {
      console.error('❌ Error during Kafka disconnect:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Flush any pending messages and disconnect
   */
  async shutdown(): Promise<void> {
    try {
      console.log('🔄 Flushing pending Kafka messages...');
      
      // Wait for any pending messages to be sent
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.disconnect();
      
      console.log(`📊 Final Kafka metrics - Published: ${this.publishCount}, Errors: ${this.errorCount}`);
    } catch (error) {
      console.error('❌ Error during Kafka shutdown:', error instanceof Error ? error.message : 'Unknown error');
    }
  }
}
