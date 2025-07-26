# Monitoring Service - Standalone HTTP Endpoint Monitor

A production-ready, detachable monitoring service that probes HTTP endpoints and tracks latency metrics in real-time. This service can be extracted and used in any project that needs endpoint monitoring with latency tracking.

## 🎯 Features

- **Standalone & Detachable**: Can be extracted and used in any project
- **High-Precision Latency Measurement**: Uses `process.hrtime.bigint()` for microsecond accuracy
- **Configurable via Environment Variables**: No code changes needed for different environments
- **InfluxDB Integration**: Optimized for time-series data storage
- **Grafana Ready**: Pre-configured dashboards for visualization
- **Docker Native**: Containerized with health checks and proper networking
- **Error Resilient**: Handles network failures, timeouts, and invalid responses gracefully
- **Concurrent Probing**: Probes multiple endpoints simultaneously for efficiency

## 🚀 Quick Start

### Option 1: Standalone Operation

Run the monitoring service with its own infrastructure:

```bash
# Clone or copy the monitoring-service directory
cd monitoring-service

# Start with example targets
docker compose -f docker-compose.standalone.yml up -d

# View logs
docker compose -f docker-compose.standalone.yml logs -f monitoring-service

# Stop everything
docker compose -f docker-compose.standalone.yml down
```

### Option 2: Integration with Existing Infrastructure

Use the monitoring service with your existing InfluxDB and Grafana:

```bash
# Build the monitoring service
docker build -t monitoring-service .

# Run with custom configuration
docker run -d \\
  --name monitoring-service \\
  --network your-network \\
  -e INFLUX_URL=http://your-influxdb:8086 \\
  -e INFLUX_TOKEN=your-token \\
  -e INFLUX_ORG=your-org \\
  -e INFLUX_BUCKET=your-bucket \\
  -e TARGETS="http://api1:8080/health,http://api2:9090/metrics" \\
  -e PROBE_INTERVAL="*/15 * * * * *" \\
  monitoring-service
```

## ⚙️ Configuration

All configuration is done through environment variables:

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `INFLUX_URL` | InfluxDB connection URL | `http://localhost:8086` | `http://influxdb:8086` |
| `INFLUX_TOKEN` | InfluxDB authentication token | `tradepulse-super-secret-auth-token` | `your-secret-token` |
| `INFLUX_ORG` | InfluxDB organization | `tradepulse` | `mycompany` |
| `INFLUX_BUCKET` | InfluxDB bucket for metrics | `metrics` | `monitoring` |
| `TARGETS` | Comma-separated list of URLs to monitor | `""` | `http://api:8080,http://web:3000/health` |
| `PROBE_INTERVAL` | Cron expression for probe frequency | `*/30 * * * * *` | `*/15 * * * * *` |

### Target Configuration Examples

```bash
# Basic health checks
TARGETS="http://api:8080/health,http://frontend:3000/health"

# Mixed protocols and ports
TARGETS="https://external-api.com/status,http://internal-service:9090/metrics"

# With different endpoints
TARGETS="http://auth:8080/health,http://database:5432,http://cache:6379/ping"
```

### Probe Interval Examples

```bash
# Every 10 seconds
PROBE_INTERVAL="*/10 * * * * *"

# Every minute
PROBE_INTERVAL="0 * * * * *"

# Every 5 minutes
PROBE_INTERVAL="0 */5 * * * *"
```

## 📊 Metrics

The service writes the following metrics to InfluxDB:

### `http_probe` Measurement

| Field | Type | Description |
|-------|------|-------------|
| `latency_ms` | float | Round-trip time in milliseconds |

| Tag | Description | Values |
|-----|-------------|--------|
| `target` | The endpoint being monitored | URL or custom name |
| `success` | Whether the probe succeeded | `true`, `false` |
| `status_code` | HTTP response status code | `200`, `404`, `500`, etc. |
| `service` | Service identifier | `monitoring-service` |

### Example InfluxDB Query

```flux
from(bucket: "metrics")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "http_probe")
  |> filter(fn: (r) => r._field == "latency_ms")
  |> group(columns: ["target"])
```

## 🔧 Development

### Local Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run built version
npm start
```

### Environment Setup

Create a `.env` file for local development:

```env
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=your-development-token
INFLUX_ORG=development
INFLUX_BUCKET=metrics
TARGETS=http://localhost:8080/health,http://localhost:3000/api/status
PROBE_INTERVAL=*/30 * * * * *
```

### Testing

```bash
# Test with httpbin service
docker run -d -p 80:80 kennethreitz/httpbin
export TARGETS="http://localhost/delay/1,http://localhost/status/200"
npm run dev
```

## 🏗️ Architecture

### Class Structure

```
MonitoringService
├── InfluxWriter          # Handles InfluxDB communication
├── ProbeManager          # Manages HTTP probing logic
└── CronJob              # Schedules regular probes
```

### Data Flow

1. **Configuration**: Load targets and settings from environment
2. **Scheduling**: Cron job triggers probes at configured intervals
3. **Probing**: ProbeManager sends HTTP requests to all targets concurrently
4. **Measurement**: High-precision latency measurement using hrtime
5. **Storage**: InfluxWriter formats and stores metrics in InfluxDB
6. **Visualization**: Grafana queries InfluxDB for real-time dashboards

## 📈 Grafana Integration

### Pre-configured Dashboards

The service includes Grafana provisioning for:

- **Latency Overview**: Average, min, max latency per target
- **Success Rate**: Success percentage over time
- **Response Codes**: Distribution of HTTP status codes
- **Target Comparison**: Side-by-side latency comparison

### Custom Dashboards

Create custom dashboards using these queries:

```flux
// Average latency per target (last 1 hour)
from(bucket: "metrics")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "http_probe")
  |> filter(fn: (r) => r._field == "latency_ms")
  |> group(columns: ["target"])
  |> aggregateWindow(every: 1m, fn: mean)

// Success rate percentage
from(bucket: "metrics")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "http_probe")
  |> filter(fn: (r) => r.success == "true")
  |> group(columns: ["target"])
  |> aggregateWindow(every: 5m, fn: count)
```

## 🔒 Security Considerations

- **Network Isolation**: Run in isolated Docker networks
- **Token Security**: Use secure, unique InfluxDB tokens
- **Non-root User**: Runs as non-root user in containers
- **Resource Limits**: Configure appropriate CPU/memory limits
- **Health Checks**: Built-in health checks for container orchestration

## 🚨 Troubleshooting

### Common Issues

#### No Metrics in InfluxDB

```bash
# Check InfluxDB connection
docker exec monitoring-service node -e "
const { InfluxWriter } = require('./dist/influx-writer');
const writer = new InfluxWriter('http://influxdb:8086', 'token', 'org', 'bucket');
writer.testConnection().then(r => console.log('Connected:', r));
"

# Check targets configuration
docker exec monitoring-service printenv TARGETS
```

#### High Latency Measurements

```bash
# Check container resources
docker stats monitoring-service

# Check network latency
docker exec monitoring-service ping target-host

# Enable debug logging
docker exec monitoring-service npm run dev
```

#### Target Connection Failures

```bash
# Test target connectivity
docker exec monitoring-service curl -v http://target-url/health

# Check DNS resolution
docker exec monitoring-service nslookup target-host
```

## 📦 Deployment

### Production Deployment

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  monitoring-service:
    image: monitoring-service:latest
    environment:
      INFLUX_URL: http://influxdb:8086
      INFLUX_TOKEN: ${INFLUX_TOKEN}
      INFLUX_ORG: production
      INFLUX_BUCKET: metrics
      TARGETS: ${MONITORING_TARGETS}
      PROBE_INTERVAL: "*/30 * * * * *"
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
        reservations:
          cpus: '0.1'
          memory: 128M
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "console.log('Health check passed')"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: monitoring-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: monitoring-service
  template:
    metadata:
      labels:
        app: monitoring-service
    spec:
      containers:
      - name: monitoring-service
        image: monitoring-service:latest
        env:
        - name: INFLUX_URL
          value: "http://influxdb:8086"
        - name: INFLUX_TOKEN
          valueFrom:
            secretKeyRef:
              name: influx-secret
              key: token
        - name: TARGETS
          value: "http://api:8080/health,http://frontend:3000/health"
        resources:
          limits:
            cpu: 500m
            memory: 256Mi
          requests:
            cpu: 100m
            memory: 128Mi
```

## 🤝 Integration Examples

### Express.js Application

```javascript
// Add health endpoint to your Express app
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Configure monitoring
// TARGETS=http://express-app:3000/health
```

### Next.js Application

```javascript
// pages/api/health.js
export default function handler(req, res) {
  res.status(200).json({ status: 'healthy', version: process.env.npm_package_version });
}

// Configure monitoring
// TARGETS=http://nextjs-app:3000/api/health
```

## 📄 License

MIT License - See LICENSE file for details.

## 🆘 Support

For issues and questions:

1. Check the troubleshooting section above
2. Review container logs: `docker logs monitoring-service`
3. Verify configuration: `docker exec monitoring-service printenv`
4. Test connectivity manually: `docker exec monitoring-service curl target-url`
