/**
 * PostgreSQL Updater for the Trade Pulse Snapshot Service
 * Handles database operations with optimized upsert operations for low-latency design
 */

import { Pool, PoolClient } from 'pg';
import { PriceTick, PriceSnapshot, SnapshotServiceConfig, DatabaseResult } from './types';

export class PostgresUpdaterService {
  private pool: Pool;
  private config: SnapshotServiceConfig;
  private isConnected = false;
  private batchQueue: PriceTick[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(config: SnapshotServiceConfig) {
    this.config = config;
    
    this.pool = new Pool({
      host: config.postgresHost,
      port: config.postgresPort,
      database: config.postgresDatabase,
      user: config.postgresUser,
      password: config.postgresPassword,
      max: config.postgresMaxConnections,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      // Optimizations for low latency
      statement_timeout: 5000, // 5 second statement timeout
      query_timeout: 5000,     // 5 second query timeout
    });

    this.setupEventHandlers();
    this.startBatchProcessor();
  }

  /**
   * Set up connection pool event handlers
   */
  private setupEventHandlers(): void {
    this.pool.on('connect', (_client) => {
      console.log('New PostgreSQL client connected');
      this.isConnected = true;
    });

    this.pool.on('error', (err, _client) => {
      console.error('PostgreSQL client error:', err);
      this.isConnected = false;
    });

    this.pool.on('acquire', (_client) => {
      // Client acquired from pool
    });

    this.pool.on('release', (_client) => {
      // Client released back to pool
    });
  }

  /**
   * Start the batch processor for efficient bulk operations
   */
  private startBatchProcessor(): void {
    this.flushTimer = setInterval(() => {
      if (this.batchQueue.length > 0) {
        this.flushBatch();
      }
    }, this.config.flushInterval);
  }

  /**
   * Initialize database connection and verify schema
   */
  public async initialize(): Promise<void> {
    try {
      console.log('Initializing PostgreSQL connection...');
      
      // Test connection
      const client = await this.pool.connect();
      console.log('PostgreSQL connection established');
      
      // Verify the price_snapshots table exists
      const tableCheck = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'price_snapshots'
        );
      `);

      if (!tableCheck.rows[0].exists) {
        throw new Error('price_snapshots table does not exist. Please run database migrations.');
      }

      console.log('Database schema verified');
      client.release();
      this.isConnected = true;
    } catch (error) {
      console.error('Failed to initialize PostgreSQL connection:', error);
      throw error;
    }
  }

  /**
   * Add a price tick to the batch queue for processing
   */
  public async addToBatch(tick: PriceTick): Promise<void> {
    this.batchQueue.push(tick);
    
    // If batch is full, flush immediately
    if (this.batchQueue.length >= this.config.batchSize) {
      await this.flushBatch();
    }
  }

  /**
   * Process a single price tick immediately (bypass batch)
   */
  public async processTick(tick: PriceTick): Promise<DatabaseResult> {
    const client = await this.pool.connect();
    
    try {
      const snapshot = this.tickToSnapshot(tick);
      const result = await this.upsertSnapshot(client, snapshot);
      return result;
    } catch (error) {
      console.error('Error processing tick:', error);
      return {
        success: false,
        rowsAffected: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    } finally {
      client.release();
    }
  }

  /**
   * Flush the current batch to database
   */
  private async flushBatch(): Promise<void> {
    if (this.batchQueue.length === 0) return;

    const batch = [...this.batchQueue];
    this.batchQueue = [];

    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      let successCount = 0;
      let errorCount = 0;

      for (const tick of batch) {
        try {
          const snapshot = this.tickToSnapshot(tick);
          const result = await this.upsertSnapshot(client, snapshot);
          if (result.success) {
            successCount += result.rowsAffected;
          } else {
            errorCount++;
          }
        } catch (error) {
          console.error('Error in batch processing tick:', error);
          errorCount++;
        }
      }

      await client.query('COMMIT');
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`Batch processed: ${successCount} successful, ${errorCount} errors`);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Batch processing failed, rolled back:', error);
    } finally {
      client.release();
    }
  }

  /**
   * Convert PriceTick to PriceSnapshot
   */
  private tickToSnapshot(tick: PriceTick): PriceSnapshot {
    const snapshot: PriceSnapshot = {
      symbol: this.cleanSymbol(tick.ric),
      price: tick.price,
      timestamp: tick.timestamp
    };
    
    if (tick.volume !== undefined) {
      snapshot.volume = tick.volume;
    }
    
    return snapshot;
  }

  /**
   * Clean symbol by removing RIC suffixes (e.g., "AAPL.O" -> "AAPL")
   */
  private cleanSymbol(ric: string): string {
    // Remove common RIC suffixes
    return ric.replace(/\.[A-Z]+$/, '').toUpperCase();
  }

  /**
   * Perform upsert operation on price_snapshots table
   */
  private async upsertSnapshot(client: PoolClient, snapshot: PriceSnapshot): Promise<DatabaseResult> {
    try {
      const query = `
        INSERT INTO price_snapshots (symbol, price, timestamp, volume)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (symbol)
        DO UPDATE SET
          price = EXCLUDED.price,
          timestamp = EXCLUDED.timestamp,
          volume = EXCLUDED.volume,
          updated_at = NOW()
        WHERE price_snapshots.timestamp <= EXCLUDED.timestamp;
      `;

      const values = [
        snapshot.symbol,
        snapshot.price,
        snapshot.timestamp,
        snapshot.volume
      ];

      const result = await client.query(query, values);
      
      return {
        success: true,
        rowsAffected: result.rowCount || 0
      };
    } catch (error) {
      console.error('Upsert operation failed:', error);
      return {
        success: false,
        rowsAffected: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get current snapshot for a specific symbol
   */
  public async getSnapshot(symbol: string): Promise<PriceSnapshot | null> {
    const client = await this.pool.connect();
    
    try {
      const query = `
        SELECT id, symbol, price, timestamp, volume, created_at, updated_at
        FROM price_snapshots
        WHERE symbol = $1;
      `;

      const result = await client.query(query, [symbol.toUpperCase()]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const snapshot: PriceSnapshot = {
        id: row.id,
        symbol: row.symbol,
        price: parseFloat(row.price),
        timestamp: parseInt(row.timestamp),
        created_at: row.created_at,
        updated_at: row.updated_at
      };
      
      if (row.volume) {
        snapshot.volume = parseFloat(row.volume);
      }
      
      return snapshot;
    } catch (error) {
      console.error('Error fetching snapshot:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all current snapshots
   */
  public async getAllSnapshots(): Promise<PriceSnapshot[]> {
    const client = await this.pool.connect();
    
    try {
      const query = `
        SELECT id, symbol, price, timestamp, volume, created_at, updated_at
        FROM price_snapshots
        ORDER BY updated_at DESC;
      `;

      const result = await client.query(query);
      
      return result.rows.map(row => {
        const snapshot: PriceSnapshot = {
          id: row.id,
          symbol: row.symbol,
          price: parseFloat(row.price),
          timestamp: parseInt(row.timestamp),
          created_at: row.created_at,
          updated_at: row.updated_at
        };
        
        if (row.volume) {
          snapshot.volume = parseFloat(row.volume);
        }
        
        return snapshot;
      });
    } catch (error) {
      console.error('Error fetching all snapshots:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get snapshots for multiple symbols
   */
  public async getSnapshots(symbols: string[]): Promise<PriceSnapshot[]> {
    if (symbols.length === 0) {
      return [];
    }

    const client = await this.pool.connect();
    
    try {
      const symbolsUpper = symbols.map(s => s.toUpperCase());
      const placeholders = symbolsUpper.map((_, index) => `$${index + 1}`).join(',');
      
      const query = `
        SELECT id, symbol, price, timestamp, volume, created_at, updated_at
        FROM price_snapshots
        WHERE symbol IN (${placeholders})
        ORDER BY updated_at DESC;
      `;

      const result = await client.query(query, symbolsUpper);
      
      return result.rows.map(row => {
        const snapshot: PriceSnapshot = {
          id: row.id,
          symbol: row.symbol,
          price: parseFloat(row.price),
          timestamp: parseInt(row.timestamp),
          created_at: row.created_at,
          updated_at: row.updated_at
        };
        
        if (row.volume) {
          snapshot.volume = parseFloat(row.volume);
        }
        
        return snapshot;
      });
    } catch (error) {
      console.error('Error fetching snapshots:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get database connection status
   */
  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get database statistics
   */
  public async getStatistics(): Promise<any> {
    const client = await this.pool.connect();
    
    try {
      const countQuery = 'SELECT COUNT(*) as total_snapshots FROM price_snapshots;';
      const latestQuery = 'SELECT MAX(updated_at) as latest_update FROM price_snapshots;';
      
      const [countResult, latestResult] = await Promise.all([
        client.query(countQuery),
        client.query(latestQuery)
      ]);

      return {
        totalSnapshots: parseInt(countResult.rows[0].total_snapshots),
        latestUpdate: latestResult.rows[0].latest_update,
        poolStats: {
          totalCount: this.pool.totalCount,
          idleCount: this.pool.idleCount,
          waitingCount: this.pool.waitingCount
        }
      };
    } catch (error) {
      console.error('Error fetching statistics:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Shutdown the service
   */
  public async shutdown(): Promise<void> {
    console.log('Shutting down PostgreSQL updater...');
    
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Flush any remaining items in the batch
    if (this.batchQueue.length > 0) {
      await this.flushBatch();
    }

    await this.pool.end();
    console.log('PostgreSQL updater shutdown complete');
  }
}
