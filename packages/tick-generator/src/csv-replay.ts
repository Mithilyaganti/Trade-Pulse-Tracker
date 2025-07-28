import * as fs from 'fs';
import * as path from 'path';
const csv = require('csv-parser');
import { PriceTick, CsvReplayConfig, StooqCsvRow } from './types';
import { TcpSender } from './tcp-sender';

/**
 * CSV replay service for historical price data
 * Supports Stooq format CSV files with configurable playback speed and looping
 */
export class CsvReplay {
  private config: CsvReplayConfig;
  private tcpSender: TcpSender;
  private isRunning = false;
  private isPaused = false;
  private currentRow = 0;
  private totalRows = 0;

  constructor(config: CsvReplayConfig, tcpSender: TcpSender) {
    this.config = config;
    this.tcpSender = tcpSender;
  }

  /**
   * Start the CSV replay process
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️  CSV replay is already running');
      return;
    }

    console.log('🎬 Starting CSV replay...');
    console.log(`📁 File: ${this.config.filePath}`);
    console.log(`⚡ Speed: ${this.config.speedMultiplier}x`);
    console.log(`🔄 Loop: ${this.config.loop ? 'enabled' : 'disabled'}`);

    // Validate file exists
    if (!fs.existsSync(this.config.filePath)) {
      throw new Error(`CSV file not found: ${this.config.filePath}`);
    }

    this.isRunning = true;
    await this.playbackFile();
  }

  /**
   * Stop the CSV replay
   */
  stop(): void {
    console.log('⏹️  Stopping CSV replay...');
    this.isRunning = false;
    this.isPaused = false;
  }

  /**
   * Pause the CSV replay
   */
  pause(): void {
    console.log('⏸️  Pausing CSV replay...');
    this.isPaused = true;
  }

  /**
   * Resume the CSV replay
   */
  resume(): void {
    console.log('▶️  Resuming CSV replay...');
    this.isPaused = false;
  }

  /**
   * Get current playback status
   */
  getStatus(): { isRunning: boolean; isPaused: boolean; currentRow: number; totalRows: number; progress: number } {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentRow: this.currentRow,
      totalRows: this.totalRows,
      progress: this.totalRows > 0 ? (this.currentRow / this.totalRows) * 100 : 0
    };
  }

  /**
   * Main playback logic
   */
  private async playbackFile(): Promise<void> {
    do {
      this.currentRow = 0;
      console.log(`🎬 ${this.currentRow === 0 ? 'Starting' : 'Restarting'} CSV playback...`);

      try {
        await this.processFile();
      } catch (error) {
        console.error('❌ Error during CSV playback:', error);
        this.isRunning = false;
        break;
      }

      if (this.config.loop && this.isRunning) {
        console.log('🔄 Looping back to start of file...');
        await this.sleep(1000); // Small delay before restarting
      }
    } while (this.config.loop && this.isRunning);

    console.log('✅ CSV replay completed');
    this.isRunning = false;
  }

  /**
   * Process the CSV file row by row
   */
  private async processFile(): Promise<void> {
    return new Promise((resolve, reject) => {
      const rows: StooqCsvRow[] = [];
      let previousTimestamp: number | null = null;

      console.log('📖 Reading CSV file...');

      fs.createReadStream(this.config.filePath)
        .pipe(csv())
        .on('data', (row: StooqCsvRow) => {
          rows.push(row);
        })
        .on('end', async () => {
          this.totalRows = rows.length;
          console.log(`📊 Loaded ${this.totalRows} rows from CSV`);

          if (rows.length === 0) {
            reject(new Error('CSV file is empty'));
            return;
          }

          try {
            // Process rows sequentially with timing
            for (let i = 0; i < rows.length && this.isRunning; i++) {
              // Handle pause
              while (this.isPaused && this.isRunning) {
                await this.sleep(100);
              }

              if (!this.isRunning) break;

              const row = rows[i];
              this.currentRow = i + 1;

              const tick = this.convertRowToTick(row);
              
              // Calculate delay for realistic timing
              if (previousTimestamp !== null) {
                const timeDiff = tick.timestamp - previousTimestamp;
                const adjustedDelay = timeDiff / this.config.speedMultiplier;
                
                if (adjustedDelay > 0) {
                  await this.sleep(adjustedDelay);
                }
              }

              // Send the tick
              await this.tcpSender.sendTick(tick);
              previousTimestamp = tick.timestamp;

              // Progress reporting every 100 rows
              if (i % 100 === 0) {
                const progress = ((i + 1) / rows.length * 100).toFixed(1);
                console.log(`📈 Progress: ${progress}% (${i + 1}/${rows.length})`);
              }
            }

            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error: any) => {
          reject(error);
        });
    });
  }

  /**
   * Convert a CSV row to a PriceTick
   */
  private convertRowToTick(row: StooqCsvRow): PriceTick {
    // Parse the date and time
    const dateTime = new Date(`${row.Date} ${row.Time}`);
    
    // Extract symbol from filename (e.g., "AAPL.csv" -> "AAPL.O")
    const filename = path.basename(this.config.filePath, '.csv');
    const ric = this.createRic(filename);

    return {
      ric: ric,
      price: parseFloat(row.Close),
      timestamp: dateTime.getTime(),
      volume: row.Volume ? parseFloat(row.Volume) : undefined,
      bid: row.Low ? parseFloat(row.Low) : undefined,
      ask: row.High ? parseFloat(row.High) : undefined
    };
  }

  /**
   * Create a Reuters Instrument Code from a symbol
   * This is a simplified mapping - in production, you'd have a proper symbol table
   */
  private createRic(symbol: string): string {
    // Simple mapping for common cases
    const ricMappings: { [key: string]: string } = {
      'AAPL': 'AAPL.O',
      'GOOGL': 'GOOGL.O',
      'MSFT': 'MSFT.O',
      'TSLA': 'TSLA.O',
      'AMZN': 'AMZN.O',
      'NVDA': 'NVDA.O',
      'META': 'META.O',
      'NFLX': 'NFLX.O',
      'EURUSD': 'EUR=',
      'GBPUSD': 'GBP=',
      'USDJPY': 'JPY=',
      'BTCUSD': 'BTC=',
      'ETHUSD': 'ETH='
    };

    return ricMappings[symbol.toUpperCase()] || `${symbol.toUpperCase()}.O`;
  }

  /**
   * Sleep utility function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
