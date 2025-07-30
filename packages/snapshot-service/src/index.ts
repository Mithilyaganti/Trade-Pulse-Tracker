/**
 * Trade Pulse Snapshot Service
 * Entry point for the service that maintains current price state and serves clients
 */

import { SnapshotService } from './snapshot-service';
import { SnapshotServiceConfig } from './types';

/**
 * Load configuration from environment variables
 */
function loadConfig(): SnapshotServiceConfig {
  return {
    // Kafka configuration
    kafkaBrokers: (process.env.KAFKA_BROKERS || 'kafka:29092').split(','),
    kafkaTopic: process.env.KAFKA_TOPIC || 'price-ticks',
    kafkaGroupId: process.env.KAFKA_GROUP_ID || 'snapshot-service-group',
    kafkaClientId: process.env.KAFKA_CLIENT_ID || 'trade-pulse-snapshot-service',

    // PostgreSQL configuration
    postgresHost: process.env.POSTGRES_HOST || 'postgres',
    postgresPort: parseInt(process.env.POSTGRES_PORT || '5432'),
    postgresDatabase: process.env.POSTGRES_DATABASE || 'tradepulse',
    postgresUser: process.env.POSTGRES_USER || 'tradepulse',
    postgresPassword: process.env.POSTGRES_PASSWORD || 'tradepulse123',
    postgresMaxConnections: parseInt(process.env.POSTGRES_MAX_CONNECTIONS || '20'),

    // REST API configuration
    restApiPort: parseInt(process.env.REST_API_PORT || '3001'),
    restApiHost: process.env.REST_API_HOST || '0.0.0.0',

    // WebSocket configuration
    websocketPort: parseInt(process.env.WEBSOCKET_PORT || '3002'),
    websocketHost: process.env.WEBSOCKET_HOST || '0.0.0.0',

    // Metrics configuration
    metricsEnabled: process.env.METRICS_ENABLED !== 'false',
    metricsPort: parseInt(process.env.METRICS_PORT || '9091'),
    metricsPath: process.env.METRICS_PATH || '/metrics',

    // Service configuration
    batchSize: parseInt(process.env.BATCH_SIZE || '50'),
    flushInterval: parseInt(process.env.FLUSH_INTERVAL || '1000'), // 1 second
    maxRetries: parseInt(process.env.MAX_RETRIES || '3')
  };
}

/**
 * Validate configuration
 */
function validateConfig(config: SnapshotServiceConfig): void {
  const errors: string[] = [];

  // Validate Kafka configuration
  if (!config.kafkaBrokers.length) {
    errors.push('KAFKA_BROKERS must be specified');
  }
  if (!config.kafkaTopic) {
    errors.push('KAFKA_TOPIC must be specified');
  }

  // Validate PostgreSQL configuration
  if (!config.postgresHost) {
    errors.push('POSTGRES_HOST must be specified');
  }
  if (!config.postgresDatabase) {
    errors.push('POSTGRES_DATABASE must be specified');
  }
  if (!config.postgresUser) {
    errors.push('POSTGRES_USER must be specified');
  }
  if (!config.postgresPassword) {
    errors.push('POSTGRES_PASSWORD must be specified');
  }

  // Validate port numbers
  if (config.restApiPort < 1 || config.restApiPort > 65535) {
    errors.push('REST_API_PORT must be between 1 and 65535');
  }
  if (config.websocketPort < 1 || config.websocketPort > 65535) {
    errors.push('WEBSOCKET_PORT must be between 1 and 65535');
  }
  if (config.metricsPort < 1 || config.metricsPort > 65535) {
    errors.push('METRICS_PORT must be between 1 and 65535');
  }

  // Validate performance settings
  if (config.batchSize < 1) {
    errors.push('BATCH_SIZE must be greater than 0');
  }
  if (config.flushInterval < 100) {
    errors.push('FLUSH_INTERVAL must be at least 100ms');
  }

  if (errors.length > 0) {
    console.error('Configuration validation failed:');
    errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
}

/**
 * Print startup banner
 */
function printBanner(config: SnapshotServiceConfig): void {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║               Trade Pulse Snapshot Service                   ║
║                                                              ║
║  Maintains current price state and serves real-time data    ║
║  to clients via REST API and WebSocket connections          ║
╚══════════════════════════════════════════════════════════════╝

🔧 Configuration:
   Kafka Brokers: ${config.kafkaBrokers.join(', ')}
   Kafka Topic: ${config.kafkaTopic}
   Database: ${config.postgresHost}:${config.postgresPort}/${config.postgresDatabase}
   REST API: http://${config.restApiHost}:${config.restApiPort}
   WebSocket: ws://${config.websocketHost}:${config.websocketPort}
   Metrics: http://${config.restApiHost}:${config.metricsPort}${config.metricsPath}

⚙️  Performance Settings:
   Batch Size: ${config.batchSize}
   Flush Interval: ${config.flushInterval}ms
   Max Connections: ${config.postgresMaxConnections}

🚀 Starting services...
`);
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    // Load and validate configuration
    const config = loadConfig();
    validateConfig(config);

    // Print startup information
    printBanner(config);

    // Create and start the service
    const service = new SnapshotService(config);
    
    // Add health check endpoint for metrics (if enabled)
    if (config.metricsEnabled) {
      const express = require('express');
      const metricsApp = express();
      
      metricsApp.get(config.metricsPath, async (_req: any, res: any) => {
        res.set('Content-Type', 'text/plain');
        const metrics = await service.getPrometheusMetrics();
        res.send(metrics);
      });

      metricsApp.get('/health', (_req: any, res: any) => {
        const health = service.getHealthStatus();
        const statusCode = health.status === 'running' ? 200 : 503;
        res.status(statusCode).json(health);
      });

      metricsApp.listen(config.metricsPort, () => {
        console.log(`📊 Metrics server started on port ${config.metricsPort}`);
      });
    }

    // Start the main service
    await service.start();

    // Keep the process running
    process.on('SIGTERM', async () => {
      console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
      await service.shutdown();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('\n🛑 Received SIGINT, shutting down gracefully...');
      await service.shutdown();
      process.exit(0);
    });

  } catch (error) {
    console.error('❌ Failed to start Snapshot Service:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the application
if (require.main === module) {
  main().catch((error) => {
    console.error('Application startup failed:', error);
    process.exit(1);
  });
}

export { SnapshotService };
export * from './types';
