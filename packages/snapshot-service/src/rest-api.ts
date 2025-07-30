/**
 * REST API for the Trade Pulse Snapshot Service
 * Serves current price snapshots via HTTP endpoints
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { PostgresUpdaterService } from './postgres-updater';
import { SnapshotServiceConfig, ApiResponse, PriceSnapshot, HealthStatus } from './types';

export class RestApiService {
  private app: Express;
  private config: SnapshotServiceConfig;
  private postgresUpdater: PostgresUpdaterService;
  private server: any;
  private startTime: number;
  private requestCount = 0;
  private errorCount = 0;

  constructor(config: SnapshotServiceConfig, postgresUpdater: PostgresUpdaterService) {
    this.config = config;
    this.postgresUpdater = postgresUpdater;
    this.startTime = Date.now();
    
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Set up Express middleware
   */
  private setupMiddleware(): void {
    // CORS support
    this.app.use(cors({
      origin: '*', // In production, specify allowed origins
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    // JSON parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Request logging middleware
    this.app.use((req: Request, res: Response, next) => {
      const start = Date.now();
      this.requestCount++;
      
      res.on('finish', () => {
        const duration = Date.now() - start;
        
        if (process.env.NODE_ENV === 'development') {
          console.log(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
        }
        
        if (res.statusCode >= 400) {
          this.errorCount++;
        }
      });
      
      next();
    });

    // Error handling middleware
    this.app.use((error: Error, _req: Request, res: Response, _next: any) => {
      console.error('API Error:', error);
      this.errorCount++;
      
      const response: ApiResponse<null> = {
        success: false,
        error: error.message || 'Internal server error',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    });
  }

  /**
   * Set up API routes
   */
  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', this.handleHealthCheck.bind(this));

    // Get all snapshots
    this.app.get('/api/snapshots', this.handleGetAllSnapshots.bind(this));

    // Get snapshot by symbol
    this.app.get('/api/snapshots/:symbol', this.handleGetSnapshot.bind(this));

    // Get multiple snapshots by symbols (POST for complex queries)
    this.app.post('/api/snapshots/query', this.handleGetSnapshots.bind(this));

    // Service statistics
    this.app.get('/api/stats', this.handleGetStatistics.bind(this));

    // API documentation
    this.app.get('/api/docs', this.handleApiDocs.bind(this));

    // Root endpoint
    this.app.get('/', (_req: Request, res: Response) => {
      res.json({
        service: 'Trade Pulse Snapshot Service',
        version: '1.0.0',
        status: 'running',
        uptime: Date.now() - this.startTime,
        endpoints: [
          'GET /health - Health check',
          'GET /api/snapshots - Get all price snapshots',
          'GET /api/snapshots/:symbol - Get snapshot by symbol',
          'POST /api/snapshots/query - Get snapshots by symbols list',
          'GET /api/stats - Service statistics',
          'GET /api/docs - API documentation'
        ]
      });
    });

    // 404 handler
    this.app.use('*', (req: Request, res: Response) => {
      const response: ApiResponse<null> = {
        success: false,
        error: `Endpoint not found: ${req.method} ${req.originalUrl}`,
        timestamp: Date.now()
      };
      res.status(404).json(response);
    });
  }

  /**
   * Handle health check requests
   */
  private async handleHealthCheck(_req: Request, res: Response): Promise<void> {
    try {
      const dbStatus = this.postgresUpdater.getConnectionStatus();
      const uptime = Date.now() - this.startTime;
      
      const health: HealthStatus = {
        status: dbStatus ? 'healthy' : 'degraded',
        kafka: true, // Kafka status would be checked from main service
        database: dbStatus,
        uptime,
        timestamp: Date.now()
      };

      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      console.error('Health check error:', error);
      
      const health: HealthStatus = {
        status: 'unhealthy',
        kafka: false,
        database: false,
        uptime: Date.now() - this.startTime,
        timestamp: Date.now(),
        errors: [error instanceof Error ? error.message : 'Unknown error']
      };
      
      res.status(503).json(health);
    }
  }

  /**
   * Handle get all snapshots requests
   */
  private async handleGetAllSnapshots(_req: Request, res: Response): Promise<void> {
    try {
      const snapshots = await this.postgresUpdater.getAllSnapshots();
      
      const response: ApiResponse<PriceSnapshot[]> = {
        success: true,
        data: snapshots,
        count: snapshots.length,
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error fetching all snapshots:', error);
      
      const response: ApiResponse<null> = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch snapshots',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }

  /**
   * Handle get snapshot by symbol requests
   */
  private async handleGetSnapshot(req: Request, res: Response): Promise<void> {
    try {
      const { symbol } = req.params;
      
      if (!symbol || symbol.trim().length === 0) {
        const response: ApiResponse<null> = {
          success: false,
          error: 'Symbol parameter is required',
          timestamp: Date.now()
        };
        res.status(400).json(response);
        return;
      }

      const snapshot = await this.postgresUpdater.getSnapshot(symbol.trim());
      
      if (!snapshot) {
        const response: ApiResponse<null> = {
          success: false,
          error: `Snapshot not found for symbol: ${symbol}`,
          timestamp: Date.now()
        };
        res.status(404).json(response);
        return;
      }

      const response: ApiResponse<PriceSnapshot> = {
        success: true,
        data: snapshot,
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error fetching snapshot:', error);
      
      const response: ApiResponse<null> = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch snapshot',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }

  /**
   * Handle get snapshots by symbols list (POST request)
   */
  private async handleGetSnapshots(req: Request, res: Response): Promise<void> {
    try {
      const { symbols } = req.body;
      
      if (!Array.isArray(symbols)) {
        const response: ApiResponse<null> = {
          success: false,
          error: 'Symbols must be an array',
          timestamp: Date.now()
        };
        res.status(400).json(response);
        return;
      }

      if (symbols.length === 0) {
        const response: ApiResponse<PriceSnapshot[]> = {
          success: true,
          data: [],
          count: 0,
          timestamp: Date.now()
        };
        res.json(response);
        return;
      }

      if (symbols.length > 100) {
        const response: ApiResponse<null> = {
          success: false,
          error: 'Maximum 100 symbols allowed per request',
          timestamp: Date.now()
        };
        res.status(400).json(response);
        return;
      }

      // Validate symbols are strings
      const validSymbols = symbols.filter(s => typeof s === 'string' && s.trim().length > 0);
      
      if (validSymbols.length === 0) {
        const response: ApiResponse<null> = {
          success: false,
          error: 'No valid symbols provided',
          timestamp: Date.now()
        };
        res.status(400).json(response);
        return;
      }

      const snapshots = await this.postgresUpdater.getSnapshots(validSymbols);
      
      const response: ApiResponse<PriceSnapshot[]> = {
        success: true,
        data: snapshots,
        count: snapshots.length,
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error fetching snapshots:', error);
      
      const response: ApiResponse<null> = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch snapshots',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }

  /**
   * Handle service statistics requests
   */
  private async handleGetStatistics(_req: Request, res: Response): Promise<void> {
    try {
      const dbStats = await this.postgresUpdater.getStatistics();
      
      const stats = {
        service: {
          uptime: Date.now() - this.startTime,
          requestCount: this.requestCount,
          errorCount: this.errorCount,
          errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0
        },
        database: dbStats,
        timestamp: Date.now()
      };
      
      const response: ApiResponse<typeof stats> = {
        success: true,
        data: stats,
        timestamp: Date.now()
      };
      
      res.json(response);
    } catch (error) {
      console.error('Error fetching statistics:', error);
      
      const response: ApiResponse<null> = {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch statistics',
        timestamp: Date.now()
      };
      
      res.status(500).json(response);
    }
  }

  /**
   * Handle API documentation requests
   */
  private handleApiDocs(_req: Request, res: Response): void {
    const docs = {
      title: 'Trade Pulse Snapshot Service API',
      version: '1.0.0',
      description: 'REST API for accessing current price snapshots',
      baseUrl: `http://${this.config.restApiHost}:${this.config.restApiPort}`,
      endpoints: [
        {
          method: 'GET',
          path: '/health',
          description: 'Service health check',
          response: 'HealthStatus object'
        },
        {
          method: 'GET',
          path: '/api/snapshots',
          description: 'Get all current price snapshots',
          response: 'Array of PriceSnapshot objects'
        },
        {
          method: 'GET',
          path: '/api/snapshots/:symbol',
          description: 'Get snapshot for a specific symbol',
          parameters: ['symbol (string): Stock symbol'],
          response: 'PriceSnapshot object or 404 if not found'
        },
        {
          method: 'POST',
          path: '/api/snapshots/query',
          description: 'Get snapshots for multiple symbols',
          body: '{ "symbols": ["AAPL", "GOOGL", "MSFT"] }',
          response: 'Array of PriceSnapshot objects'
        },
        {
          method: 'GET',
          path: '/api/stats',
          description: 'Get service and database statistics',
          response: 'Statistics object'
        }
      ],
      schemas: {
        PriceSnapshot: {
          id: 'string',
          symbol: 'string',
          price: 'number',
          timestamp: 'number',
          volume: 'number (optional)',
          created_at: 'string (ISO date)',
          updated_at: 'string (ISO date)'
        },
        ApiResponse: {
          success: 'boolean',
          data: 'object (optional)',
          error: 'string (optional)',
          timestamp: 'number',
          count: 'number (optional)'
        }
      }
    };

    res.json(docs);
  }

  /**
   * Start the REST API server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.restApiPort, this.config.restApiHost, () => {
          console.log(`REST API server started on http://${this.config.restApiHost}:${this.config.restApiPort}`);
          resolve();
        });

        this.server.on('error', (error: Error) => {
          console.error('REST API server error:', error);
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the REST API server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('REST API server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server statistics
   */
  public getServerStats() {
    return {
      uptime: Date.now() - this.startTime,
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0
    };
  }
}
