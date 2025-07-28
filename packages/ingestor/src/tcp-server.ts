import * as net from 'net';
import { 
  TcpServerConfig, 
  ClientConnection, 
  RawMessage, 
  ServiceMetrics, 
  ErrorType, 
  IngestorError 
} from './types';

/**
 * TCP server for receiving price tick data from tick generators
 * Handles multiple concurrent connections with proper lifecycle management
 */
export class TcpServer {
  private server: net.Server;
  private config: TcpServerConfig;
  private clients: Map<string, ClientConnection> = new Map();
  private isListening = false;
  private messageHandler?: (message: RawMessage) => void;
  
  // Metrics
  private totalConnections = 0;
  private totalMessages = 0;
  private startTime = Date.now();

  constructor(config: TcpServerConfig) {
    this.config = config;
    this.server = net.createServer();
    this.setupServerEventHandlers();
  }

  /**
   * Set up server-level event handlers
   */
  private setupServerEventHandlers(): void {
    this.server.on('listening', () => {
      const address = this.server.address();
      const addr = typeof address === 'string' ? address : `${address?.address}:${address?.port}`;
      console.log(`🚀 TCP server listening on ${addr}`);
      this.isListening = true;
    });

    this.server.on('connection', (socket) => {
      this.handleNewConnection(socket);
    });

    this.server.on('error', (error) => {
      console.error('❌ TCP server error:', error.message);
      this.isListening = false;
      
      // Attempt to restart the server after a delay
      setTimeout(() => {
        if (!this.isListening) {
          console.log('🔄 Attempting to restart TCP server...');
          this.start().catch(err => {
            console.error('❌ Failed to restart TCP server:', err.message);
          });
        }
      }, 5000);
    });

    this.server.on('close', () => {
      console.log('🔌 TCP server closed');
      this.isListening = false;
    });
  }

  /**
   * Handle new client connections
   */
  private handleNewConnection(socket: net.Socket): void {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();
    
    const client: ClientConnection = {
      id: clientId,
      socket,
      connectedAt: now,
      messageCount: 0,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort
    };

    this.clients.set(clientId, client);
    this.totalConnections++;

    console.log(`📱 New client connected: ${clientId} from ${client.remoteAddress}:${client.remotePort} (total: ${this.clients.size})`);

    // Configure socket options for optimal performance
    socket.setKeepAlive(this.config.keepAlive, this.config.keepAliveInitialDelay);
    socket.setNoDelay(true); // Disable Nagle's algorithm for low latency
    
    // Set up client event handlers
    this.setupClientEventHandlers(clientId, socket);
  }

  /**
   * Set up event handlers for individual client connections
   */
  private setupClientEventHandlers(clientId: string, socket: net.Socket): void {
    let buffer = ''; // Buffer for handling partial messages

    socket.on('data', (data) => {
      try {
        const client = this.clients.get(clientId);
        if (!client) {
          console.warn(`⚠️  Received data from unknown client: ${clientId}`);
          return;
        }

        // Add new data to buffer
        buffer += data.toString();

        // Process complete messages (separated by newlines)
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const message = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (message.trim()) {
            this.handleMessage(clientId, message.trim());
          }
        }

        // Update client statistics
        client.lastMessageAt = Date.now();

      } catch (error) {
        console.error(`❌ Error processing data from client ${clientId}:`, error instanceof Error ? error.message : 'Unknown error');
        socket.write('ERROR: Failed to process message\n');
      }
    });

    socket.on('error', (error) => {
      console.error(`❌ Client ${clientId} error:`, error.message);
      this.handleClientDisconnection(clientId, 'error');
    });

    socket.on('close', (hadError) => {
      const reason = hadError ? 'error' : 'normal';
      this.handleClientDisconnection(clientId, reason);
    });

    socket.on('timeout', () => {
      console.warn(`⏰ Client ${clientId} timed out`);
      socket.end();
    });

    // Set socket timeout (optional)
    socket.setTimeout(300000); // 5 minutes timeout
  }

  /**
   * Handle incoming messages from clients
   */
  private handleMessage(clientId: string, messageData: string): void {
    const client = this.clients.get(clientId);
    if (!client) {
      console.warn(`⚠️  Message from unknown client: ${clientId}`);
      return;
    }

    // Update client message count
    client.messageCount++;
    this.totalMessages++;

    // Create raw message object
    const rawMessage: RawMessage = {
      data: messageData,
      clientId,
      receivedAt: Date.now()
    };

    // Log message reception (rate-limited)
    if (this.totalMessages % 100 === 0) {
      console.log(`📨 Processed ${this.totalMessages} messages (client ${clientId}: ${client.messageCount})`);
    }

    // Forward to message handler if available
    if (this.messageHandler) {
      try {
        this.messageHandler(rawMessage);
      } catch (error) {
        console.error(`❌ Message handler error for client ${clientId}:`, error instanceof Error ? error.message : 'Unknown error');
        
        // Send error response to client
        client.socket.write(`ERROR: ${error instanceof Error ? error.message : 'Processing failed'}\n`);
      }
    }
  }

  /**
   * Handle client disconnections
   */
  private handleClientDisconnection(clientId: string, reason: string): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    const duration = Date.now() - client.connectedAt;
    const durationSeconds = (duration / 1000).toFixed(1);

    console.log(`📱 Client ${clientId} disconnected (${reason}) after ${durationSeconds}s, processed ${client.messageCount} messages`);

    // Clean up client connection
    this.clients.delete(clientId);

    // Close socket if still open
    if (!client.socket.destroyed) {
      client.socket.destroy();
    }
  }

  /**
   * Set the message handler function
   */
  setMessageHandler(handler: (message: RawMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Start the TCP server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isListening) {
        resolve();
        return;
      }

      // Check if we can bind to the port
      this.server.once('listening', () => {
        resolve();
      });

      this.server.once('error', (error) => {
        reject(new IngestorError(
          ErrorType.TCP_CONNECTION_ERROR,
          `Failed to start TCP server: ${error.message}`,
          { host: this.config.host, port: this.config.port, error }
        ));
      });

      // Start listening
      this.server.listen(this.config.port, this.config.host);
    });
  }

  /**
   * Stop the TCP server gracefully
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      console.log('🔄 Stopping TCP server...');

      // Close all client connections first
      for (const [clientId, client] of this.clients) {
        console.log(`📱 Closing connection to client ${clientId}`);
        client.socket.end('Server shutting down\n');
      }

      // Wait a moment for graceful disconnections
      setTimeout(() => {
        // Force close any remaining connections
        for (const [clientId, client] of this.clients) {
          if (!client.socket.destroyed) {
            client.socket.destroy();
          }
        }
        this.clients.clear();

        // Close the server
        this.server.close(() => {
          console.log('✅ TCP server stopped gracefully');
          resolve();
        });
      }, 1000);
    });
  }

  /**
   * Get server metrics for monitoring
   */
  getMetrics(): Partial<ServiceMetrics> {
    const uptime = Date.now() - this.startTime;
    const uptimeSeconds = uptime / 1000;
    const messagesPerSecond = uptimeSeconds > 0 ? (this.totalMessages / uptimeSeconds).toFixed(2) : '0';

    return {
      activeConnections: this.clients.size,
      totalConnections: this.totalConnections,
      messagesReceived: this.totalMessages,
      // Additional derived metrics
      ...({
        uptimeSeconds,
        messagesPerSecond: parseFloat(messagesPerSecond),
        averageMessagesPerClient: this.totalConnections > 0 ? Math.round(this.totalMessages / this.totalConnections) : 0
      })
    };
  }

  /**
   * Get connected clients information (for debugging/monitoring)
   */
  getConnectedClients(): ClientConnection[] {
    return Array.from(this.clients.values()).map(client => ({
      ...client,
      socket: undefined // Don't expose socket object
    }));
  }

  /**
   * Check if server is currently listening
   */
  isServerListening(): boolean {
    return this.isListening;
  }

  /**
   * Send a message to a specific client (for testing or admin purposes)
   */
  sendToClient(clientId: string, message: string): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.socket.destroyed) {
      return false;
    }

    try {
      client.socket.write(message + '\n');
      return true;
    } catch (error) {
      console.error(`❌ Failed to send message to client ${clientId}:`, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(message: string): number {
    let successCount = 0;
    
    for (const [clientId, client] of this.clients) {
      if (this.sendToClient(clientId, message)) {
        successCount++;
      }
    }

    return successCount;
  }
}
