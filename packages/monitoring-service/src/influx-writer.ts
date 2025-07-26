import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';

/**
 * InfluxDB Writer - Handles metric data writing to InfluxDB
 * This class provides a clean interface for writing latency metrics
 * and can be easily extracted for use in other projects.
 */
export class InfluxWriter {
  private influxDB: InfluxDB;
  private writeApi: WriteApi;

  constructor(
    private url: string,
    private token: string,
    private org: string,
    private bucket: string
  ) {
    this.influxDB = new InfluxDB({ url, token });
    this.writeApi = this.influxDB.getWriteApi(org, bucket);
    
    // Configure batch settings for better performance
    this.writeApi.useDefaultTags({ service: 'monitoring-service' });
  }

  /**
   * Write a latency measurement to InfluxDB
   * @param target - The endpoint that was probed
   * @param latency - Round-trip time in milliseconds
   * @param success - Whether the probe was successful
   * @param statusCode - HTTP status code (if available)
   */
  writeLatencyMetric(
    target: string,
    latency: number,
    success: boolean,
    statusCode?: number
  ): void {
    const point = new Point('http_probe')
      .tag('target', target)
      .tag('success', success.toString())
      .floatField('latency_ms', latency)
      .timestamp(new Date());

    if (statusCode !== undefined) {
      point.tag('status_code', statusCode.toString());
    }

    this.writeApi.writePoint(point);
  }

  /**
   * Write a general metric to InfluxDB
   * @param measurement - The measurement name
   * @param tags - Key-value pairs for tags
   * @param fields - Key-value pairs for fields
   */
  writeMetric(
    measurement: string,
    tags: { [key: string]: string },
    fields: { [key: string]: number | string | boolean }
  ): void {
    const point = new Point(measurement);
    
    Object.entries(tags).forEach(([key, value]) => {
      point.tag(key, value);
    });

    Object.entries(fields).forEach(([key, value]) => {
      if (typeof value === 'number') {
        point.floatField(key, value);
      } else if (typeof value === 'boolean') {
        point.booleanField(key, value);
      } else {
        point.stringField(key, value);
      }
    });

    point.timestamp(new Date());
    this.writeApi.writePoint(point);
  }

  /**
   * Flush pending writes and close the connection
   */
  async close(): Promise<void> {
    try {
      await this.writeApi.close();
      console.log('InfluxDB connection closed successfully');
    } catch (error) {
      console.error('Error closing InfluxDB connection:', error);
      throw error;
    }
  }

  /**
   * Test the connection to InfluxDB
   */
  async testConnection(): Promise<boolean> {
    try {
      const queryApi = this.influxDB.getQueryApi(this.org);
      await queryApi.queryRaw('from(bucket:"' + this.bucket + '") |> range(start: -1m) |> limit(n:1)');
      return true;
    } catch (error) {
      console.error('InfluxDB connection test failed:', error);
      return false;
    }
  }
}
