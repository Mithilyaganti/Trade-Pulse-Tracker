import * as WS from 'ws';
import { PriceTick, BinanceRelayConfig, BinanceTick } from './types';
import { TcpSender } from './tcp-sender';

/**
 * Binance WebSocket relay service
 * Connects to Binance's real-time WebSocket API and forwards price updates
 */
export class BinanceRelay {
  private config: BinanceRelayConfig;
  private tcpSender: TcpSender;
  private ws: WS.WebSocket | null = null;
  private isRunning = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectInterval = 5000; // 5 seconds
  private tickCount = 0;
  private startTime = Date.now();

  constructor(config: BinanceRelayConfig, tcpSender: TcpSender) {
    this.config = config;
    this.tcpSender = tcpSender;
  }

  /**
   * Start the Binance WebSocket connection
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  Binance relay is already running');
      return;
    }

    console.log('🚀 Starting Binance WebSocket relay...');
    console.log(`🎯 Symbols: ${this.config.symbols.join(', ')}`);
    console.log(`🌐 Base URL: ${this.config.baseUrl}`);

    this.isRunning = true;
    this.startTime = Date.now();
    await this.connect();
  }

  /**
   * Stop the Binance relay
   */
  stop(): void {
    console.log('⏹️  Stopping Binance relay...');
    this.isRunning = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.logStatistics();
  }

  /**
   * Get current relay status
   */
  getStatus(): { isRunning: boolean; isConnected: boolean; tickCount: number; uptime: number; symbols: string[] } {
    return {
      isRunning: this.isRunning,
      isConnected: this.ws?.readyState === WS.WebSocket.OPEN,
      tickCount: this.tickCount,
      uptime: Date.now() - this.startTime,
      symbols: this.config.symbols
    };
  }

  /**
   * Establish WebSocket connection to Binance
   */
  private async connect(): Promise<void> {
    try {
      const streamUrl = this.buildStreamUrl();
      console.log(`🔌 Connecting to Binance WebSocket: ${streamUrl}`);

      this.ws = new WS.WebSocket(streamUrl);

      this.ws.on('open', () => {
        console.log('✅ Binance WebSocket connected');
        this.reconnectAttempts = 0;
      });

      this.ws.on('message', (data: any) => {
        this.handleMessage(data);
      });

      this.ws.on('error', (error) => {
        console.error('❌ Binance WebSocket error:', error.message);
        this.handleDisconnection();
      });

      this.ws.on('close', (code, reason) => {
        console.log(`🔌 Binance WebSocket closed: ${code} ${reason}`);
        this.handleDisconnection();
      });

      // Send ping every 3 minutes to keep connection alive
      this.startPingInterval();

    } catch (error) {
      console.error('❌ Failed to connect to Binance WebSocket:', error);
      this.handleDisconnection();
    }
  }

  /**
   * Build the WebSocket stream URL for multiple symbols
   */
  private buildStreamUrl(): string {
    // Convert symbols to lowercase and create ticker streams
    const streams = this.config.symbols.map(symbol => 
      `${symbol.toLowerCase()}@ticker`
    ).join('/');

    return `${this.config.baseUrl}/ws/${streams}`;
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: any): void {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle single stream vs combined stream format
      if (message.stream) {
        // Combined stream format
        this.processTick(message.data);
      } else {
        // Single stream format
        this.processTick(message);
      }
    } catch (error) {
      console.error('❌ Failed to parse WebSocket message:', error);
    }
  }

  /**
   * Process a Binance tick and convert to our format
   */
  private async processTick(binanceTick: BinanceTick): Promise<void> {
    try {
      // Convert Binance tick to our PriceTick format
      const tick: PriceTick = {
        ric: this.binanceSymbolToRic(binanceTick.s),
        price: parseFloat(binanceTick.c),
        timestamp: binanceTick.E, // Binance provides timestamp in milliseconds
        volume: parseFloat(binanceTick.v),
        bid: parseFloat(binanceTick.l), // Using low as bid approximation
        ask: parseFloat(binanceTick.h)  // Using high as ask approximation
      };

      // Send to TCP sender
      await this.tcpSender.sendTick(tick);
      
      this.tickCount++;

      // Log stats every 100 ticks
      if (this.tickCount % 100 === 0) {
        const uptime = (Date.now() - this.startTime) / 1000;
        const rate = (this.tickCount / uptime).toFixed(2);
        console.log(`📊 Processed ${this.tickCount} ticks (${rate} ticks/sec)`);
      }

    } catch (error) {
      console.error('❌ Failed to process Binance tick:', error);
    }
  }

  /**
   * Convert Binance symbol to Reuters Instrument Code
   */
  private binanceSymbolToRic(symbol: string): string {
    // Simple mapping for common crypto pairs
    const cryptoMappings: { [key: string]: string } = {
      'BTCUSDT': 'BTC=',
      'ETHUSDT': 'ETH=',
      'BNBUSDT': 'BNB=',
      'XRPUSDT': 'XRP=',
      'ADAUSDT': 'ADA=',
      'SOLUSDT': 'SOL=',
      'DOTUSDT': 'DOT=',
      'DOGEUSDT': 'DOGE=',
      'AVAXUSDT': 'AVAX=',
      'MATICUSDT': 'MATIC=',
      'LINKUSDT': 'LINK=',
      'UNIUSDT': 'UNI=',
      'LTCUSDT': 'LTC=',
      'BCHUSDT': 'BCH=',
      'XLMUSDT': 'XLM=',
      'ATOMUSDT': 'ATOM=',
      'VETUSDT': 'VET=',
      'FILUSDT': 'FIL=',
      'TRXUSDT': 'TRX=',
      'ETCUSDT': 'ETC='
    };

    return cryptoMappings[symbol] || `${symbol}=`;
  }

  /**
   * Handle connection loss and attempt reconnection
   */
  private handleDisconnection(): void {
    if (!this.isRunning) {
      return; // Service is intentionally stopped
    }

    if (this.reconnectTimer) {
      return; // Reconnection already in progress
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached. Stopping relay.`);
      this.stop();
      return;
    }

    this.reconnectAttempts++;
    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectInterval}ms...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.isRunning) {
        await this.connect();
      }
    }, this.reconnectInterval);
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    const pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WS.WebSocket.OPEN) {
        this.ws.ping();
      } else {
        clearInterval(pingInterval);
      }
    }, 180000); // 3 minutes
  }

  /**
   * Log relay statistics
   */
  private logStatistics(): void {
    const uptime = (Date.now() - this.startTime) / 1000;
    const avgRate = uptime > 0 ? (this.tickCount / uptime).toFixed(2) : '0';
    
    console.log('📊 Binance Relay Statistics:');
    console.log(`   Total ticks processed: ${this.tickCount}`);
    console.log(`   Uptime: ${uptime.toFixed(1)} seconds`);
    console.log(`   Average rate: ${avgRate} ticks/second`);
    console.log(`   Symbols monitored: ${this.config.symbols.length}`);
  }
}
