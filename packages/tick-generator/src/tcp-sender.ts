import * as net from 'net';
import { PriceTick, TcpSenderConfig } from './types';

/**
 * TCP sender for delivering price ticks to the ingestor service
 * Handles connection management, reconnection logic, and message formatting
 */
export class TcpSender {
  private config: TcpSenderConfig;
  private socket: net.Socket | null = null;
  private reconnectAttempts = 0;
  private isConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private messageQueue: string[] = [];

  constructor(config: TcpSenderConfig) {
    this.config = config;
  }

  /**
   * Initialize the TCP connection
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`🔌 Connecting to TCP server at ${this.config.host}:${this.config.port}...`);
      
      this.socket = new net.Socket();
      
      // Set up event handlers
      this.socket.on('connect', () => {
        console.log('✅ TCP connection established');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        // Send any queued messages
        this.flushMessageQueue();
        
        resolve();
      });

      this.socket.on('error', (error) => {
        console.error('❌ TCP connection error:', error.message);
        this.isConnected = false;
        
        if (this.reconnectAttempts === 0) {
          // First error, reject the initial connection promise
          reject(error);
        } else {
          // Subsequent errors, handle via reconnection logic
          this.handleDisconnection();
        }
      });

      this.socket.on('close', () => {
        console.log('🔌 TCP connection closed');
        this.isConnected = false;
        this.handleDisconnection();
      });

      this.socket.on('data', (data) => {
        // Handle any response from the server (usually just acknowledgments)
        console.log('📨 Received from server:', data.toString().trim());
      });

      // Attempt connection
      this.socket.connect(this.config.port, this.config.host);
    });
  }

  /**
   * Send a price tick to the ingestor
   */
  async sendTick(tick: PriceTick): Promise<void> {
    const message = this.formatTick(tick);
    
    if (this.isConnected && this.socket) {
      try {
        this.socket.write(message + '\n');
        console.log(`📤 Sent tick: ${tick.ric} @ ${tick.price} (${new Date(tick.timestamp).toISOString()})`);
      } catch (error) {
        console.error('❌ Failed to send tick:', error);
        this.messageQueue.push(message);
        this.handleDisconnection();
      }
    } else {
      // Queue the message for later delivery
      console.log(`📋 Queuing tick (connection unavailable): ${tick.ric} @ ${tick.price}`);
      this.messageQueue.push(message);
    }
  }

  /**
   * Format a price tick for transmission
   * Uses a simple pipe-delimited format: RIC|PRICE|TIMESTAMP|VOLUME|BID|ASK
   */
  private formatTick(tick: PriceTick): string {
    return [
      tick.ric,
      tick.price.toString(),
      tick.timestamp.toString(),
      tick.volume?.toString() || '',
      tick.bid?.toString() || '',
      tick.ask?.toString() || ''
    ].join('|');
  }

  /**
   * Handle connection loss and attempt reconnection
   */
  private handleDisconnection(): void {
    if (this.reconnectTimer) {
      return; // Reconnection already in progress
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${this.config.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.config.maxReconnectAttempts} in ${this.config.reconnectInterval}ms...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      
      try {
        await this.connect();
      } catch (error) {
        console.error('🔄 Reconnection failed:', error);
        // The error handler will trigger another reconnection attempt
      }
    }, this.config.reconnectInterval);
  }

  /**
   * Send all queued messages
   */
  private flushMessageQueue(): void {
    if (this.messageQueue.length === 0) {
      return;
    }

    console.log(`📤 Sending ${this.messageQueue.length} queued messages...`);
    
    for (const message of this.messageQueue) {
      if (this.socket && this.isConnected) {
        this.socket.write(message + '\n');
      }
    }
    
    this.messageQueue = [];
    console.log('✅ Message queue flushed');
  }

  /**
   * Close the connection gracefully
   */
  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      if (this.socket) {
        console.log('🔌 Closing TCP connection...');
        this.socket.end();
        
        this.socket.on('close', () => {
          console.log('✅ TCP connection closed gracefully');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get connection status
   */
  isConnectionActive(): boolean {
    return this.isConnected;
  }

  /**
   * Get the number of queued messages
   */
  getQueuedMessageCount(): number {
    return this.messageQueue.length;
  }
}
