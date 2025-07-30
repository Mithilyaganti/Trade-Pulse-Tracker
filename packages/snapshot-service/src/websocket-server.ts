/**
 * WebSocket Server for the Trade Pulse Snapshot Service
 * Provides real-time price updates to connected clients
 */

import WebSocket from 'ws';
import { PostgresUpdaterService } from './postgres-updater';
import { 
  SnapshotServiceConfig, 
  WebSocketMessage, 
  WebSocketMessageType, 
  ClientSubscription, 
  PriceSnapshot 
} from './types';

export class WebSocketServerService {
  private server: WebSocket.Server;
  private config: SnapshotServiceConfig;
  private postgresUpdater: PostgresUpdaterService;
  private clients: Map<string, WebSocket> = new Map();
  private subscriptions: Map<string, ClientSubscription> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private startTime: number;
  private messagesSent = 0;

  constructor(config: SnapshotServiceConfig, postgresUpdater: PostgresUpdaterService) {
    this.config = config;
    this.postgresUpdater = postgresUpdater;
    this.startTime = Date.now();
    
    this.server = new WebSocket.Server({
      port: config.websocketPort,
      host: config.websocketHost,
      perMessageDeflate: false,
      maxPayload: 1024 * 1024, // 1MB max message size
    });

    this.setupEventHandlers();
    this.startHeartbeat();
  }

  /**
   * Set up WebSocket server event handlers
   */
  private setupEventHandlers(): void {
    this.server.on('connection', this.handleConnection.bind(this));
    
    this.server.on('error', (error: Error) => {
      console.error('WebSocket server error:', error);
    });

    this.server.on('listening', () => {
      console.log(`WebSocket server started on ws://${this.config.websocketHost}:${this.config.websocketPort}`);
    });

    this.server.on('close', () => {
      console.log('WebSocket server closed');
    });
  }

  /**
   * Handle new WebSocket connections
   */
  private handleConnection(ws: WebSocket, request: any): void {
    const clientId = this.generateClientId();
    const clientIp = request.socket.remoteAddress;
    
    console.log(`New WebSocket connection: ${clientId} from ${clientIp}`);
    
    // Store client connection
    this.clients.set(clientId, ws);
    this.subscriptions.set(clientId, {
      clientId,
      symbols: new Set<string>(),
      lastHeartbeat: Date.now()
    });

    // Set up client event handlers
    ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(clientId, data);
    });

    ws.on('close', (code: number, reason: Buffer) => {
      console.log(`Client disconnected: ${clientId}, code: ${code}, reason: ${reason.toString()}`);
      this.cleanupClient(clientId);
    });

    ws.on('error', (error: Error) => {
      console.error(`Client error: ${clientId}:`, error);
      this.cleanupClient(clientId);
    });

    ws.on('pong', () => {
      // Update heartbeat
      const subscription = this.subscriptions.get(clientId);
      if (subscription) {
        subscription.lastHeartbeat = Date.now();
      }
    });

    // Send welcome message
    this.sendMessage(clientId, {
      type: WebSocketMessageType.HEARTBEAT,
      data: {
        message: 'Connected to Trade Pulse WebSocket',
        clientId,
        serverTime: Date.now()
      } as any,
      timestamp: Date.now()
    });
  }

  /**
   * Handle incoming messages from clients
   */
  private handleMessage(clientId: string, data: WebSocket.Data): void {
    try {
      const messageStr = data.toString();
      let message: WebSocketMessage;

      try {
        message = JSON.parse(messageStr);
      } catch (parseError) {
        console.error(`Invalid JSON from client ${clientId}:`, parseError);
        this.sendError(clientId, 'Invalid JSON message format');
        return;
      }

      // Validate message structure
      if (!message.type || !Object.values(WebSocketMessageType).includes(message.type)) {
        this.sendError(clientId, 'Invalid message type');
        return;
      }

      // Update heartbeat
      const subscription = this.subscriptions.get(clientId);
      if (subscription) {
        subscription.lastHeartbeat = Date.now();
      }

      // Handle different message types
      switch (message.type) {
        case WebSocketMessageType.SUBSCRIBE:
          this.handleSubscribe(clientId, message);
          break;
        
        case WebSocketMessageType.UNSUBSCRIBE:
          this.handleUnsubscribe(clientId, message);
          break;
        
        case WebSocketMessageType.HEARTBEAT:
          // Echo heartbeat back
          this.sendMessage(clientId, {
            type: WebSocketMessageType.HEARTBEAT,
            timestamp: Date.now()
          });
          break;
        
        default:
          this.sendError(clientId, `Unsupported message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`Error handling message from client ${clientId}:`, error);
      this.sendError(clientId, 'Internal server error');
    }
  }

  /**
   * Handle subscription requests
   */
  private async handleSubscribe(clientId: string, message: WebSocketMessage): Promise<void> {
    const subscription = this.subscriptions.get(clientId);
    if (!subscription) {
      this.sendError(clientId, 'Client subscription not found');
      return;
    }

    try {
      // Handle single symbol subscription
      if (message.symbol) {
        const symbol = message.symbol.toUpperCase().trim();
        if (symbol.length === 0) {
          this.sendError(clientId, 'Invalid symbol');
          return;
        }

        subscription.symbols.add(symbol);
        
        // Send current snapshot if available
        const snapshot = await this.postgresUpdater.getSnapshot(symbol);
        if (snapshot) {
          this.sendMessage(clientId, {
            type: WebSocketMessageType.PRICE_UPDATE,
            symbol: symbol,
            data: snapshot,
            timestamp: Date.now()
          });
        }

        console.log(`Client ${clientId} subscribed to ${symbol}`);
        return;
      }

      // Handle multiple symbols subscription
      if (message.symbols && Array.isArray(message.symbols)) {
        const validSymbols = message.symbols
          .filter(s => typeof s === 'string' && s.trim().length > 0)
          .map(s => s.toUpperCase().trim());

        if (validSymbols.length === 0) {
          this.sendError(clientId, 'No valid symbols provided');
          return;
        }

        // Add to subscription
        validSymbols.forEach(symbol => subscription.symbols.add(symbol));

        // Send current snapshots if available
        const snapshots = await this.postgresUpdater.getSnapshots(validSymbols);
        if (snapshots.length > 0) {
          this.sendMessage(clientId, {
            type: WebSocketMessageType.PRICE_UPDATE,
            data: snapshots,
            timestamp: Date.now()
          });
        }

        console.log(`Client ${clientId} subscribed to ${validSymbols.length} symbols`);
        return;
      }

      this.sendError(clientId, 'No symbols specified for subscription');
    } catch (error) {
      console.error(`Error handling subscription for client ${clientId}:`, error);
      this.sendError(clientId, 'Failed to process subscription');
    }
  }

  /**
   * Handle unsubscription requests
   */
  private handleUnsubscribe(clientId: string, message: WebSocketMessage): void {
    const subscription = this.subscriptions.get(clientId);
    if (!subscription) {
      this.sendError(clientId, 'Client subscription not found');
      return;
    }

    try {
      // Handle single symbol unsubscription
      if (message.symbol) {
        const symbol = message.symbol.toUpperCase().trim();
        subscription.symbols.delete(symbol);
        console.log(`Client ${clientId} unsubscribed from ${symbol}`);
        return;
      }

      // Handle multiple symbols unsubscription
      if (message.symbols && Array.isArray(message.symbols)) {
        const symbolsToRemove = message.symbols
          .filter(s => typeof s === 'string' && s.trim().length > 0)
          .map(s => s.toUpperCase().trim());

        symbolsToRemove.forEach(symbol => subscription.symbols.delete(symbol));
        console.log(`Client ${clientId} unsubscribed from ${symbolsToRemove.length} symbols`);
        return;
      }

      // If no specific symbols, unsubscribe from all
      const count = subscription.symbols.size;
      subscription.symbols.clear();
      console.log(`Client ${clientId} unsubscribed from all ${count} symbols`);
    } catch (error) {
      console.error(`Error handling unsubscription for client ${clientId}:`, error);
      this.sendError(clientId, 'Failed to process unsubscription');
    }
  }

  /**
   * Broadcast price update to subscribed clients
   */
  public broadcastPriceUpdate(snapshot: PriceSnapshot): void {
    const symbol = snapshot.symbol.toUpperCase();
    let sentCount = 0;

    this.subscriptions.forEach((subscription, clientId) => {
      if (subscription.symbols.has(symbol)) {
        const success = this.sendMessage(clientId, {
          type: WebSocketMessageType.PRICE_UPDATE,
          symbol: symbol,
          data: snapshot,
          timestamp: Date.now()
        });
        
        if (success) {
          sentCount++;
        }
      }
    });

    if (process.env.NODE_ENV === 'development' && sentCount > 0) {
      console.log(`Price update for ${symbol} sent to ${sentCount} clients`);
    }
  }

  /**
   * Send message to a specific client
   */
  private sendMessage(clientId: string, message: WebSocketMessage): boolean {
    const ws = this.clients.get(clientId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      const messageStr = JSON.stringify(message);
      ws.send(messageStr);
      this.messagesSent++;
      return true;
    } catch (error) {
      console.error(`Error sending message to client ${clientId}:`, error);
      this.cleanupClient(clientId);
      return false;
    }
  }

  /**
   * Send error message to client
   */
  private sendError(clientId: string, error: string): void {
    this.sendMessage(clientId, {
      type: WebSocketMessageType.ERROR,
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const heartbeatTimeout = 60000; // 60 seconds

      // Check for dead connections
      const deadClients: string[] = [];
      
      this.subscriptions.forEach((subscription, clientId) => {
        if (now - subscription.lastHeartbeat > heartbeatTimeout) {
          deadClients.push(clientId);
        }
      });

      // Cleanup dead connections
      deadClients.forEach(clientId => {
        console.log(`Cleaning up dead client: ${clientId}`);
        this.cleanupClient(clientId);
      });

      // Send ping to all active clients
      this.clients.forEach((ws, clientId) => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
          } catch (error) {
            console.error(`Error pinging client ${clientId}:`, error);
            this.cleanupClient(clientId);
          }
        }
      });

    }, 30000); // Check every 30 seconds
  }

  /**
   * Cleanup client connection
   */
  private cleanupClient(clientId: string): void {
    const ws = this.clients.get(clientId);
    if (ws) {
      try {
        ws.terminate();
      } catch (error) {
        // Ignore termination errors
      }
    }

    this.clients.delete(clientId);
    this.subscriptions.delete(clientId);
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get server statistics
   */
  public getStats() {
    return {
      connectedClients: this.clients.size,
      totalSubscriptions: Array.from(this.subscriptions.values())
        .reduce((total, sub) => total + sub.symbols.size, 0),
      messagesSent: this.messagesSent,
      uptime: Date.now() - this.startTime
    };
  }

  /**
   * Get client information
   */
  public getClientInfo(): Array<{clientId: string, symbols: string[], lastHeartbeat: number}> {
    return Array.from(this.subscriptions.values()).map(sub => ({
      clientId: sub.clientId,
      symbols: Array.from(sub.symbols),
      lastHeartbeat: sub.lastHeartbeat
    }));
  }

  /**
   * Shutdown the WebSocket server
   */
  public async shutdown(): Promise<void> {
    console.log('Shutting down WebSocket server...');
    
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all client connections
    this.clients.forEach((ws, _clientId) => {
      try {
        ws.close(1001, 'Server shutting down');
      } catch (error) {
        // Ignore closing errors
      }
    });

    // Close server
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('WebSocket server shutdown complete');
        resolve();
      });
    });
  }
}
