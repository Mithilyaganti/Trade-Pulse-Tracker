import axios, { AxiosResponse } from 'axios';
import { InfluxWriter } from './influx-writer';

/**
 * Configuration for a probe target
 */
export interface ProbeTarget {
  url: string;
  name?: string;
  timeout?: number;
  expectedStatus?: number;
}

/**
 * Result of a probe operation
 */
export interface ProbeResult {
  target: string;
  latency: number;
  success: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Probe Manager - Handles HTTP endpoint probing with latency measurement
 * This class is designed to be middleware-agnostic and can be easily
 * extracted for use in other monitoring projects.
 */
export class ProbeManager {
  private influxWriter: InfluxWriter;
  private targets: ProbeTarget[] = [];

  constructor(influxWriter: InfluxWriter) {
    this.influxWriter = influxWriter;
  }

  /**
   * Add a target to be probed
   * @param target - Target configuration
   */
  addTarget(target: ProbeTarget): void {
    this.targets.push({
      timeout: 5000,
      expectedStatus: 200,
      ...target,
      name: target.name || target.url
    });
  }

  /**
   * Add multiple targets from a configuration
   * @param targets - Array of target configurations
   */
  addTargets(targets: ProbeTarget[]): void {
    targets.forEach(target => this.addTarget(target));
  }

  /**
   * Parse targets from environment variable string
   * Format: "http://service1:8080,http://service2:9090,http://service3:3000/health"
   * @param targetsString - Comma-separated list of URLs
   */
  addTargetsFromString(targetsString: string): void {
    if (!targetsString) return;

    const urls = targetsString.split(',')
      .map(url => url.trim())
      .filter(url => url.length > 0);

    urls.forEach(url => {
      this.addTarget({ url });
    });
  }

  /**
   * Probe a single target and measure latency
   * @param target - Target to probe
   * @returns Promise with probe result
   */
  async probeTarget(target: ProbeTarget): Promise<ProbeResult> {
    const startTime = process.hrtime.bigint();
    
    try {
      const response: AxiosResponse = await axios.get(target.url, {
        timeout: target.timeout || 5000,
        validateStatus: () => true, // Don't throw on any status code
      });

      const endTime = process.hrtime.bigint();
      const latency = Number(endTime - startTime) / 1_000_000; // Convert to milliseconds

      const success = response.status === (target.expectedStatus || 200);

      return {
        target: target.name || target.url,
        latency,
        success,
        statusCode: response.status
      };
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const latency = Number(endTime - startTime) / 1_000_000;

      return {
        target: target.name || target.url,
        latency,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Probe all configured targets
   * @returns Promise with array of probe results
   */
  async probeAllTargets(): Promise<ProbeResult[]> {
    if (this.targets.length === 0) {
      console.warn('No targets configured for probing');
      return [];
    }

    console.log(`Probing ${this.targets.length} targets...`);
    
    const probePromises = this.targets.map(target => this.probeTarget(target));
    const results = await Promise.allSettled(probePromises);

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          target: this.targets[index].name || this.targets[index].url,
          latency: 0,
          success: false,
          error: result.reason?.message || 'Probe failed'
        };
      }
    });
  }

  /**
   * Probe all targets and write results to InfluxDB
   */
  async probeAndRecord(): Promise<void> {
    const results = await this.probeAllTargets();
    
    results.forEach(result => {
      // Write to InfluxDB
      this.influxWriter.writeLatencyMetric(
        result.target,
        result.latency,
        result.success,
        result.statusCode
      );

      // Log result
      if (result.success) {
        console.log(`✓ ${result.target}: ${result.latency.toFixed(2)}ms (${result.statusCode})`);
      } else {
        console.log(`✗ ${result.target}: ${result.error || 'Failed'} (${result.latency.toFixed(2)}ms)`);
      }
    });
  }

  /**
   * Get the current list of targets
   */
  getTargets(): ProbeTarget[] {
    return [...this.targets];
  }

  /**
   * Clear all targets
   */
  clearTargets(): void {
    this.targets = [];
  }
}
