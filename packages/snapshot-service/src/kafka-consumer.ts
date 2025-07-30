/**
 * Kafka Consumer for the Trade Pulse Snapshot Service
 * Consumes price tick messages from the Kafka topic and processes them
 */

import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { PriceTick, SnapshotServiceConfig } from './types';

export class KafkaConsumerService {
  private kafka: Kafka;
  private consumer: Consumer;
  private config: SnapshotServiceConfig;
  private messageHandler: ((tick: PriceTick) => Promise<void>) | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectInterval = 5000; // 5 seconds

  constructor(config: SnapshotServiceConfig) {
    this.config = config;
    
    this.kafka = new Kafka({
      clientId: config.kafkaClientId,
      brokers: config.kafkaBrokers,
      retry: {
        initialRetryTime: 100,
        retries: 8,
        multiplier: 2,
        maxRetryTime: 30000,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    this.consumer = this.kafka.consumer({
      groupId: config.kafkaGroupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576, // 1MB
      retry: {
        initialRetryTime: 100,
        retries: 8,
        multiplier: 2,
        maxRetryTime: 30000,
      },
    });

    this.setupErrorHandlers();
  }

  /**
   * Set up error handlers for the Kafka consumer
   */
  private setupErrorHandlers(): void {
    this.consumer.on('consumer.crash', (event) => {
      console.error('Kafka consumer crashed:', event);
      this.handleReconnection();
    });

    this.consumer.on('consumer.disconnect', () => {
      console.warn('Kafka consumer disconnected');
      this.isConnected = false;
      this.handleReconnection();
    });

    this.consumer.on('consumer.connect', () => {
      console.log('Kafka consumer connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
    });

    this.consumer.on('consumer.network.request_timeout', (event) => {
      console.warn('Kafka network request timeout:', event);
    });
  }

  /**
   * Handle reconnection logic with exponential backoff
   */
  private async handleReconnection(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached. Stopping consumer.');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);
    
    setTimeout(async () => {
      try {
        await this.disconnect();
        await this.connect();
      } catch (error) {
        console.error('Reconnection failed:', error);
        this.handleReconnection();
      }
    }, delay);
  }

  /**
   * Set the message handler function
   */
  public setMessageHandler(handler: (tick: PriceTick) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Connect to Kafka and start consuming messages
   */
  public async connect(): Promise<void> {
    try {
      console.log('Connecting to Kafka...');
      await this.consumer.connect();
      
      console.log(`Subscribing to topic: ${this.config.kafkaTopic}`);
      await this.consumer.subscribe({ 
        topic: this.config.kafkaTopic,
        fromBeginning: false // Only consume new messages
      });

      console.log('Starting message consumption...');
      await this.consumer.run({
        partitionsConsumedConcurrently: 3,
        eachMessage: this.handleMessage.bind(this),
      });

      this.isConnected = true;
      console.log('Kafka consumer started successfully');
    } catch (error) {
      console.error('Failed to connect to Kafka:', error);
      throw error;
    }
  }

  /**
   * Handle incoming Kafka messages
   */
  private async handleMessage(payload: EachMessagePayload): Promise<void> {
    const { topic, partition, message, heartbeat } = payload;

    try {
      // Parse the message value
      if (!message.value) {
        console.warn('Received empty message, skipping');
        return;
      }

      const messageStr = message.value.toString();
      let priceTick: PriceTick;

      try {
        priceTick = JSON.parse(messageStr);
      } catch (parseError) {
        console.error('Failed to parse message JSON:', parseError, 'Raw message:', messageStr);
        return;
      }

      // Validate the price tick structure
      if (!this.isValidPriceTick(priceTick)) {
        console.warn('Invalid price tick structure:', priceTick);
        return;
      }

      // Call heartbeat to keep the consumer alive during processing
      await heartbeat();

      // Process the message with the handler
      if (this.messageHandler) {
        await this.messageHandler(priceTick);
      } else {
        console.warn('No message handler set, skipping message processing');
      }

      // Log processing details (can be made configurable)
      if (process.env.NODE_ENV === 'development') {
        console.log(`Processed message from topic: ${topic}, partition: ${partition}, offset: ${message.offset}, symbol: ${priceTick.ric}`);
      }

    } catch (error) {
      console.error('Error processing message:', error);
      // Don't throw here to avoid consumer crashes
      // The error will be logged and the consumer will continue
    }
  }

  /**
   * Validate price tick structure
   */
  private isValidPriceTick(tick: any): tick is PriceTick {
    return (
      tick &&
      typeof tick.ric === 'string' &&
      typeof tick.price === 'number' &&
      typeof tick.timestamp === 'number' &&
      tick.ric.length > 0 &&
      !isNaN(tick.price) &&
      !isNaN(tick.timestamp) &&
      tick.price > 0 &&
      tick.timestamp > 0
    );
  }

  /**
   * Disconnect from Kafka
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.isConnected) {
        console.log('Disconnecting from Kafka...');
        await this.consumer.disconnect();
        this.isConnected = false;
        console.log('Kafka consumer disconnected');
      }
    } catch (error) {
      console.error('Error disconnecting from Kafka:', error);
      throw error;
    }
  }

  /**
   * Get consumer connection status
   */
  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Pause consumption
   */
  public async pause(): Promise<void> {
    try {
      await this.consumer.pause([{ topic: this.config.kafkaTopic }]);
      console.log('Kafka consumer paused');
    } catch (error) {
      console.error('Error pausing Kafka consumer:', error);
      throw error;
    }
  }

  /**
   * Resume consumption
   */
  public async resume(): Promise<void> {
    try {
      await this.consumer.resume([{ topic: this.config.kafkaTopic }]);
      console.log('Kafka consumer resumed');
    } catch (error) {
      console.error('Error resuming Kafka consumer:', error);
      throw error;
    }
  }

  /**
   * Get consumer metadata
   */
  public async getMetadata(): Promise<any> {
    try {
      const admin = this.kafka.admin();
      await admin.connect();
      const metadata = await admin.fetchTopicMetadata({ topics: [this.config.kafkaTopic] });
      await admin.disconnect();
      return metadata;
    } catch (error) {
      console.error('Error fetching metadata:', error);
      throw error;
    }
  }
}
