import * as cron from 'node-cron';
import { InfluxWriter } from './influx-writer';
import { ProbeManager } from './probe-manager';

/**
 * Configuration interface for the Monitoring Service
 */
interface MonitoringConfig {
  influxUrl: string;
  influxToken: string;
  influxOrg: string;
  influxBucket: string;
  targets: string;
  probeInterval: string;
}

/**
 * Monitoring Service - A standalone, detachable monitoring service
 * This service can be extracted and used in any project that needs
 * HTTP endpoint monitoring with latency tracking.
 */
class MonitoringService {
  private config: MonitoringConfig;
  private influxWriter: InfluxWriter;
  private probeManager: ProbeManager;
  private cronJob: cron.ScheduledTask | null = null;

  constructor() {
    // Load configuration from environment variables
    this.config = {
      influxUrl: process.env.INFLUX_URL || 'http://localhost:8086',
      influxToken: process.env.INFLUX_TOKEN || 'tradepulse-super-secret-auth-token',
      influxOrg: process.env.INFLUX_ORG || 'tradepulse',
      influxBucket: process.env.INFLUX_BUCKET || 'metrics',
      targets: process.env.TARGETS || '',
      probeInterval: process.env.PROBE_INTERVAL || '*/30 * * * * *' // Every 30 seconds
    };

    // Initialize components
    this.influxWriter = new InfluxWriter(
      this.config.influxUrl,
      this.config.influxToken,
      this.config.influxOrg,
      this.config.influxBucket
    );

    this.probeManager = new ProbeManager(this.influxWriter);

    console.log('🚀 Monitoring Service initializing...');
    console.log(`📊 InfluxDB: ${this.config.influxUrl}`);
    console.log(`⏰ Probe Interval: ${this.config.probeInterval}`);
  }

  /**
   * Initialize the monitoring service
   */
  async initialize(): Promise<void> {
    try {
      // Test InfluxDB connection
      console.log('🔍 Testing InfluxDB connection...');
      const connected = await this.influxWriter.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to InfluxDB');
      }
      console.log('✅ InfluxDB connection successful');

      // Configure targets
      this.configureTargets();

      // Start monitoring
      this.startMonitoring();

      console.log('🎯 Monitoring Service is running');
    } catch (error) {
      console.error('❌ Failed to initialize Monitoring Service:', error);
      throw error;
    }
  }

  /**
   * Configure monitoring targets from environment
   */
  private configureTargets(): void {
    if (!this.config.targets) {
      console.warn('⚠️  No targets specified in TARGETS environment variable');
      console.log('   Set TARGETS="http://service1:8080,http://service2:9090" to start monitoring');
      return;
    }

    console.log('🎯 Configuring targets...');
    this.probeManager.addTargetsFromString(this.config.targets);
    
    const targets = this.probeManager.getTargets();
    console.log(`📋 Configured ${targets.length} targets:`);
    targets.forEach(target => {
      console.log(`   - ${target.name} (${target.url})`);
    });
  }

  /**
   * Start the monitoring cron job
   */
  private startMonitoring(): void {
    if (this.probeManager.getTargets().length === 0) {
      console.log('⚠️  No targets to monitor. Waiting for configuration...');
      return;
    }

    console.log(`⏰ Starting monitoring with interval: ${this.config.probeInterval}`);
    
    this.cronJob = cron.schedule(this.config.probeInterval, async () => {
      try {
        await this.probeManager.probeAndRecord();
      } catch (error) {
        console.error('❌ Error during probing:', error);
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    // Run an initial probe immediately
    setTimeout(async () => {
      try {
        console.log('🚀 Running initial probe...');
        await this.probeManager.probeAndRecord();
      } catch (error) {
        console.error('❌ Error during initial probe:', error);
      }
    }, 1000);
  }

  /**
   * Stop the monitoring service
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping Monitoring Service...');
    
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }

    await this.influxWriter.close();
    console.log('✅ Monitoring Service stopped');
  }
}

/**
 * Application entry point
 */
async function main(): Promise<void> {
  const service = new MonitoringService();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\\n📡 Received SIGINT, shutting down gracefully...');
    await service.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\\n📡 Received SIGTERM, shutting down gracefully...');
    await service.stop();
    process.exit(0);
  });

  try {
    await service.initialize();
  } catch (error) {
    console.error('💥 Failed to start Monitoring Service:', error);
    process.exit(1);
  }
}

// Start the service if this file is run directly
if (require.main === module) {
  main().catch(error => {
    console.error('💥 Unhandled error:', error);
    process.exit(1);
  });
}

export { MonitoringService, InfluxWriter, ProbeManager };
