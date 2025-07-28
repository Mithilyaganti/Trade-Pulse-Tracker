#!/usr/bin/env node

import { IngestorService } from './ingestor-service';
import { IngestorConfig } from './types';

/**
 * Main entry point for the Trade Pulse Ingestor Service
 * Loads configuration from environment variables and starts the service
 */

/**
 * Load configuration from environment variables with sensible defaults
 */
function loadConfiguration(): IngestorConfig {
  const config: IngestorConfig = {
    tcp: {
      host: process.env.TCP_HOST || '0.0.0.0',
      port: parseInt(process.env.TCP_PORT || '8080', 10),
      maxConnections: parseInt(process.env.TCP_MAX_CONNECTIONS || '100', 10),
      keepAlive: process.env.TCP_KEEP_ALIVE === 'true',
      keepAliveInitialDelay: parseInt(process.env.TCP_KEEP_ALIVE_DELAY || '30000', 10)
    },
    kafka: {
      brokers: (process.env.KAFKA_BROKERS || 'kafka:29092').split(','),
      clientId: process.env.KAFKA_CLIENT_ID || 'trade-pulse-ingestor',
      topic: process.env.KAFKA_TOPIC || 'price-ticks',
      acks: parseInt(process.env.KAFKA_ACKS || '1', 10) as -1 | 0 | 1,
      retries: parseInt(process.env.KAFKA_RETRIES || '3', 10),
      compression: (process.env.KAFKA_COMPRESSION as 'gzip' | 'snappy' | 'lz4' | 'zstd') || undefined,
      batchSize: parseInt(process.env.KAFKA_BATCH_SIZE || '16384', 10),
      lingerMs: parseInt(process.env.KAFKA_LINGER_MS || '10', 10)
    },
    metrics: {
      enabled: process.env.METRICS_ENABLED !== 'false',
      port: parseInt(process.env.METRICS_PORT || '9090', 10),
      path: process.env.METRICS_PATH || '/metrics'
    },
    validation: {
      strictMode: process.env.VALIDATION_STRICT_MODE === 'true',
      maxPriceDeviation: parseFloat(process.env.VALIDATION_MAX_PRICE_DEVIATION || '0.1'), // 10%
      maxTimestampAge: parseInt(process.env.VALIDATION_MAX_TIMESTAMP_AGE || '300000', 10) // 5 minutes
    }
  };

  return config;
}

/**
 * Validate the loaded configuration
 */
function validateConfiguration(config: IngestorConfig): void {
  const errors: string[] = [];

  // TCP validation
  if (config.tcp.port < 1 || config.tcp.port > 65535) {
    errors.push(`Invalid TCP port: ${config.tcp.port}. Must be between 1 and 65535`);
  }

  if (config.tcp.maxConnections < 1) {
    errors.push(`Invalid max connections: ${config.tcp.maxConnections}. Must be at least 1`);
  }

  // Kafka validation
  if (config.kafka.brokers.length === 0) {
    errors.push('At least one Kafka broker must be specified');
  }

  if (!config.kafka.topic.trim()) {
    errors.push('Kafka topic cannot be empty');
  }

  if (![0, 1, -1].includes(config.kafka.acks)) {
    errors.push(`Invalid Kafka acks value: ${config.kafka.acks}. Must be 0, 1, or -1`);
  }

  // Metrics validation
  if (config.metrics.enabled && (config.metrics.port < 1 || config.metrics.port > 65535)) {
    errors.push(`Invalid metrics port: ${config.metrics.port}. Must be between 1 and 65535`);
  }

  // Validation rules validation
  if (config.validation.maxPriceDeviation < 0 || config.validation.maxPriceDeviation > 1) {
    errors.push(`Invalid max price deviation: ${config.validation.maxPriceDeviation}. Must be between 0 and 1`);
  }

  if (config.validation.maxTimestampAge < 0) {
    errors.push(`Invalid max timestamp age: ${config.validation.maxTimestampAge}. Must be non-negative`);
  }

  if (errors.length > 0) {
    console.error('❌ Configuration validation failed:');
    errors.forEach(error => console.error(`   - ${error}`));
    process.exit(1);
  }
}

/**
 * Print configuration summary
 */
function printConfiguration(config: IngestorConfig): void {
  console.log('🔧 Ingestor Configuration:');
  console.log('   TCP Server:');
  console.log(`     Host: ${config.tcp.host}`);
  console.log(`     Port: ${config.tcp.port}`);
  console.log(`     Max Connections: ${config.tcp.maxConnections}`);
  console.log(`     Keep Alive: ${config.tcp.keepAlive}`);
  
  console.log('   Kafka:');
  console.log(`     Brokers: ${config.kafka.brokers.join(', ')}`);
  console.log(`     Topic: ${config.kafka.topic}`);
  console.log(`     Client ID: ${config.kafka.clientId}`);
  console.log(`     Acks: ${config.kafka.acks}`);
  console.log(`     Retries: ${config.kafka.retries}`);
  console.log(`     Compression: ${config.kafka.compression || 'none'}`);
  
  console.log('   Metrics:');
  console.log(`     Enabled: ${config.metrics.enabled}`);
  if (config.metrics.enabled) {
    console.log(`     Port: ${config.metrics.port}`);
    console.log(`     Path: ${config.metrics.path}`);
  }
  
  console.log('   Validation:');
  console.log(`     Strict Mode: ${config.validation.strictMode}`);
  console.log(`     Max Price Deviation: ${(config.validation.maxPriceDeviation * 100).toFixed(1)}%`);
  console.log(`     Max Timestamp Age: ${(config.validation.maxTimestampAge / 1000).toFixed(1)}s`);
}

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  try {
    console.log('🚀 Trade Pulse Ingestor Service');
    console.log('===================================');

    // Load and validate configuration
    const config = loadConfiguration();
    validateConfiguration(config);
    printConfiguration(config);

    console.log('\n🔄 Starting service...\n');

    // Create and start the ingestor service
    const ingestor = new IngestorService(config);
    await ingestor.start();

    // Keep the process running
    console.log('\n✅ Service is running. Press Ctrl+C to stop.');

  } catch (error) {
    console.error('\n💥 Failed to start ingestor service:');
    console.error(error instanceof Error ? error.message : 'Unknown error');
    
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

/**
 * Handle CLI help and version
 */
function handleCliArgs(): void {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Trade Pulse Ingestor Service');
    console.log('');
    console.log('A TCP server that receives price tick data, validates it, and publishes to Kafka.');
    console.log('');
    console.log('Usage:');
    console.log('  npm start                 Start the ingestor service');
    console.log('  npm run dev               Start in development mode');
    console.log('  node dist/index.js        Start the compiled service');
    console.log('');
    console.log('Configuration via environment variables:');
    console.log('  TCP_HOST                  TCP server host (default: 0.0.0.0)');
    console.log('  TCP_PORT                  TCP server port (default: 8080)');
    console.log('  TCP_MAX_CONNECTIONS       Maximum concurrent connections (default: 100)');
    console.log('  TCP_KEEP_ALIVE            Enable TCP keep-alive (default: false)');
    console.log('  KAFKA_BROKERS             Comma-separated Kafka brokers (default: kafka:29092)');
    console.log('  KAFKA_TOPIC               Kafka topic for price ticks (default: price-ticks)');
    console.log('  KAFKA_CLIENT_ID           Kafka client identifier (default: trade-pulse-ingestor)');
    console.log('  KAFKA_ACKS                Kafka acknowledgment mode: 0, 1, or -1 (default: 1)');
    console.log('  KAFKA_RETRIES             Number of retry attempts (default: 3)');
    console.log('  KAFKA_COMPRESSION         Compression type: gzip, snappy, lz4, zstd (default: none)');
    console.log('  METRICS_ENABLED           Enable Prometheus metrics (default: true)');
    console.log('  METRICS_PORT              Metrics server port (default: 9090)');
    console.log('  METRICS_PATH              Metrics endpoint path (default: /metrics)');
    console.log('  VALIDATION_STRICT_MODE    Reject messages with any validation errors (default: false)');
    console.log('  VALIDATION_MAX_PRICE_DEVIATION  Maximum price change percentage (default: 0.1)');
    console.log('  VALIDATION_MAX_TIMESTAMP_AGE    Maximum message age in milliseconds (default: 300000)');
    console.log('');
    console.log('Examples:');
    console.log('  TCP_PORT=9999 KAFKA_TOPIC=my-ticks npm start');
    console.log('  VALIDATION_STRICT_MODE=true METRICS_ENABLED=false npm run dev');
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    const packageJson = require('../package.json');
    console.log(`Trade Pulse Ingestor v${packageJson.version}`);
    process.exit(0);
  }
}

// Handle CLI arguments first
handleCliArgs();

// Start the application
main().catch((error) => {
  console.error('💥 Unhandled error in main:', error);
  process.exit(1);
});
