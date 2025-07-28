# Trade Pulse Ingestor Service

A high-performance TCP server that receives financial price tick data, validates it, and publishes it to Kafka for downstream processing. Part of the Trade Pulse Tracker real-time data pipeline.

## 🎯 Purpose

The ingestor service acts as the entry point for price data in the Trade Pulse Tracker system. It:

- **Receives** price ticks via TCP from tick generator services
- **Validates** data format, business rules, and detects anomalies
- **Enriches** ticks with server-side metadata and latency calculations
- **Publishes** validated data to Kafka for downstream consumption
- **Monitors** performance with detailed metrics and health checks

## 🏗️ Architecture

```
┌─────────────┐    TCP     ┌─────────────────┐    Kafka    ┌─────────────┐
│ Tick        │ ---------> │ Ingestor        │ ---------> │ Snapshot    │
│ Generator   │            │ Service         │            │ Service     │
└─────────────┘            │                 │            └─────────────┘
                           │ - TCP Server    │
                           │ - Validator     │
                           │ - Kafka Publisher│
                           │ - Metrics       │
                           └─────────────────┘
                                    │
                                    v
                           ┌─────────────────┐
                           │ Prometheus      │
                           │ Metrics         │
                           └─────────────────┘
```

## 📦 Components

### Core Components

- **TCP Server** (`tcp-server.ts`) - Handles multiple concurrent TCP connections
- **Message Validator** (`message-validator.ts`) - Validates format and business rules
- **Kafka Publisher** (`kafka-publisher.ts`) - Publishes to Kafka with retry logic
- **Metrics Exporter** (`metrics-exporter.ts`) - Prometheus metrics endpoint
- **Ingestor Service** (`ingestor-service.ts`) - Main orchestrator

### Message Flow

1. **TCP Reception** - Receive pipe-delimited messages from tick generators
2. **Parsing** - Parse `RIC|PRICE|TIMESTAMP|VOLUME|BID|ASK` format
3. **Validation** - Validate format, business rules, and detect anomalies
4. **Enrichment** - Add server metadata, sequence IDs, and latency calculations
5. **Publishing** - Send to Kafka with proper partitioning and headers
6. **Monitoring** - Record metrics for performance and error tracking

## 🚀 Quick Start

### Using Docker Compose (Recommended)

```bash
# Start with the main Trade Pulse infrastructure
docker-compose up -d kafka postgres influxdb

# Start the ingestor service
docker-compose up -d ingestor

# View logs
docker-compose logs -f ingestor
```

### Standalone Development

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev

# Build and start production mode
npm run build
npm start
```

## 🔧 Configuration

Configuration is done via environment variables:

### TCP Server Configuration

| Variable               | Default   | Description                    |
| ---------------------- | --------- | ------------------------------ |
| `TCP_HOST`             | `0.0.0.0` | Host to bind TCP server        |
| `TCP_PORT`             | `8080`    | Port for TCP server            |
| `TCP_MAX_CONNECTIONS`  | `100`     | Maximum concurrent connections |
| `TCP_KEEP_ALIVE`       | `false`   | Enable TCP keep-alive          |
| `TCP_KEEP_ALIVE_DELAY` | `30000`   | Keep-alive initial delay (ms)  |

### Kafka Configuration

| Variable            | Default                | Description                          |
| ------------------- | ---------------------- | ------------------------------------ |
| `KAFKA_BROKERS`     | `kafka:29092`          | Comma-separated Kafka brokers        |
| `KAFKA_TOPIC`       | `price-ticks`          | Topic for publishing ticks           |
| `KAFKA_CLIENT_ID`   | `trade-pulse-ingestor` | Kafka client identifier              |
| `KAFKA_ACKS`        | `1`                    | Acknowledgment mode (0, 1, -1)       |
| `KAFKA_RETRIES`     | `3`                    | Number of retry attempts             |
| `KAFKA_COMPRESSION` | `none`                 | Compression: gzip, snappy, lz4, zstd |
| `KAFKA_BATCH_SIZE`  | `16384`                | Batch size for publishing            |
| `KAFKA_LINGER_MS`   | `10`                   | Time to wait for batching            |

### Validation Configuration

| Variable                         | Default  | Description                  |
| -------------------------------- | -------- | ---------------------------- |
| `VALIDATION_STRICT_MODE`         | `false`  | Reject any validation errors |
| `VALIDATION_MAX_PRICE_DEVIATION` | `0.1`    | Max price change (10%)       |
| `VALIDATION_MAX_TIMESTAMP_AGE`   | `300000` | Max message age (5 minutes)  |

### Metrics Configuration

| Variable          | Default    | Description               |
| ----------------- | ---------- | ------------------------- |
| `METRICS_ENABLED` | `true`     | Enable Prometheus metrics |
| `METRICS_PORT`    | `9090`     | Metrics server port       |
| `METRICS_PATH`    | `/metrics` | Metrics endpoint path     |

## 📨 Message Format

The ingestor expects TCP messages in pipe-delimited format:

```
RIC|PRICE|TIMESTAMP|VOLUME|BID|ASK
```

### Examples

```bash
# Apple stock tick
AAPL.O|150.60|1705323000000|1000000|150.10|150.75

# Bitcoin price tick
BTC=|43250.50|1705323001000|5.24|43240.00|43260.00

# Minimal tick (only required fields)
EUR=|1.0850|1705323002000|||
```

### Field Descriptions

- **RIC** (Required): Reuters Instrument Code (e.g., `AAPL.O`, `BTC=`)
- **PRICE** (Required): Current price as positive number
- **TIMESTAMP** (Required): Unix timestamp in milliseconds
- **VOLUME** (Optional): Trading volume
- **BID** (Optional): Bid price
- **ASK** (Optional): Ask price

## 🔍 Validation Rules

### Format Validation

- Message must have exactly 6 pipe-delimited fields
- RIC must be 2-20 characters, alphanumeric with dots/equals
- Price must be positive number
- Timestamp must be valid Unix timestamp in reasonable range
- Optional fields can be empty but must be valid numbers if present

### Business Rules

- Bid price must be ≤ Ask price (if both present)
- Current price should be within bid/ask spread
- Price changes > configured deviation threshold trigger warnings
- Timestamps cannot be too old or too far in future
- Zero volume trades can be rejected in strict mode

### Anomaly Detection

- Large price deviations from recent prices
- Suspicious volume levels
- Invalid bid/ask spreads
- Timestamp inconsistencies

## 📊 Monitoring & Metrics

### Prometheus Metrics

Access metrics at `http://localhost:9090/metrics`:

#### Connection Metrics

- `ingestor_connections_total` - Total connections received
- `ingestor_active_connections` - Current active connections

#### Message Metrics

- `ingestor_messages_received_total` - Messages received via TCP
- `ingestor_messages_processed_total` - Successfully processed messages
- `ingestor_messages_failed_total` - Failed message processing
- `ingestor_messages_published_total` - Messages published to Kafka

#### Performance Metrics

- `ingestor_processing_duration_seconds` - Message processing time
- `ingestor_validation_errors_total` - Validation error counts
- `ingestor_publish_errors_total` - Kafka publishing errors

### Health Checks

```bash
# Check service health
curl http://localhost:9090/metrics

# Check Kafka connectivity via logs
docker-compose logs ingestor | grep "Kafka"

# Check TCP server status
netstat -an | grep :8080
```

### Performance Monitoring

The service logs performance statistics every 30 seconds:

```
📊 Status Report (uptime: 120s):
   Active connections: 2
   Messages: received=1500, processed=1485, failed=15
   Throughput: 12.38 msg/s, avg processing: 2.45ms
   Kafka: published=1485, errors=0
```

## 🧪 Testing

### Manual Testing with Netcat

```bash
# Send test message
echo "AAPL.O|150.60|$(date +%s)000|1000000|150.10|150.75" | nc localhost 8080

# Send multiple test messages
for i in {1..100}; do
  echo "TEST.SYMBOL|$(echo "scale=2; 100 + $i/10" | bc)|$(date +%s)000|||" | nc localhost 8080
done
```

### Using Tick Generator

```bash
# Start tick generator to send CSV data
docker-compose run --rm tick-generator \
  node dist/index.js --source=csv --file=/app/data/AAPL.csv --host=ingestor --port=8080

# Start Binance relay
docker-compose run --rm tick-generator \
  node dist/index.js --source=binance --symbols=BTCUSDT --host=ingestor --port=8080
```

### Validation Testing

```bash
# Test invalid messages
echo "INVALID_FORMAT" | nc localhost 8080
echo "TOO|FEW|FIELDS" | nc localhost 8080
echo "AAPL.O|-100|invalid_timestamp|||" | nc localhost 8080
```

## 🔄 Integration with Trade Pulse Tracker

### Phase Integration

- **Phase 3**: Receives data from tick-generator service
- **Phase 5**: Publishes to Kafka for snapshot-service consumption
- **Phase 2**: Monitored by monitoring-service for health checks

### Data Flow

```
Tick Generator → TCP:8080 → Ingestor → Kafka:price-ticks → Snapshot Service
                                ↓
                          Metrics:9090 → Monitoring Service
```

### Kafka Topic Structure

Published messages include enriched tick data:

```json
{
	"ric": "AAPL.O",
	"price": 150.6,
	"timestamp": 1705323000000,
	"volume": 1000000,
	"bid": 150.1,
	"ask": 150.75,
	"receivedAt": 1705323000015,
	"clientId": "client-1705323000000-abc123",
	"sequenceId": "1705323000015-1",
	"latencyMs": 15,
	"validationPassed": true,
	"validationErrors": []
}
```

## 🚨 Error Handling

### Connection Errors

- TCP connections are handled gracefully with proper cleanup
- Failed connections are logged with client information
- Server continues operating with partial connection failures

### Validation Errors

- Invalid messages are logged but don't stop processing
- Validation errors are categorized and counted for monitoring
- Strict mode can reject messages with any validation errors

### Kafka Errors

- Automatic retry with exponential backoff
- Message queuing during temporary Kafka outages
- Connection health monitoring and reconnection

### Resource Management

- Connection limits prevent resource exhaustion
- Graceful shutdown ensures message delivery completion
- Memory usage monitoring for large message volumes

## 🔧 Development

### Project Structure

```
src/
├── index.ts              # Main entry point with configuration
├── ingestor-service.ts   # Main service orchestrator
├── tcp-server.ts         # TCP connection handling
├── message-validator.ts  # Message validation and business rules
├── kafka-publisher.ts    # Kafka publishing with retry logic
├── metrics-exporter.ts   # Prometheus metrics exporter
└── types.ts             # TypeScript type definitions
```

### Adding New Validation Rules

1. Add rule to `MessageValidator.validateBusinessRules()`
2. Add error category to `categorizeValidationError()`
3. Add corresponding metric in `MetricsExporter`
4. Update tests and documentation

### Performance Optimization

- Use connection pooling for high-throughput scenarios
- Adjust Kafka batch settings for latency vs throughput
- Monitor memory usage with large message volumes
- Consider message compression for network efficiency

## 🐛 Troubleshooting

### Common Issues

**Port Already in Use**

```bash
# Check what's using port 8080
lsof -i :8080
# Kill process or change TCP_PORT
```

**Kafka Connection Failed**

```bash
# Check Kafka is running
docker-compose ps kafka
# Check network connectivity
docker-compose exec ingestor ping kafka
```

**High Memory Usage**

```bash
# Check connection count
curl -s http://localhost:9090/metrics | grep active_connections
# Reduce TCP_MAX_CONNECTIONS if needed
```

**Message Validation Failures**

```bash
# Check validation error metrics
curl -s http://localhost:9090/metrics | grep validation_errors
# Review recent error logs
docker-compose logs --tail=100 ingestor | grep "Validation failed"
```

### Debug Mode

Enable detailed logging:

```bash
# Set debug environment
DEBUG=* npm run dev

# Or in Docker
docker-compose run -e DEBUG=* ingestor npm run dev
```

## 📈 Performance Characteristics

### Throughput

- **Single Connection**: ~1,000-5,000 messages/second
- **Multiple Connections**: ~10,000+ messages/second (depending on hardware)
- **Kafka Publishing**: Limited by Kafka cluster performance

### Latency

- **TCP to Kafka**: Typically <5ms for simple messages
- **Validation**: <1ms for standard validation rules
- **Network Overhead**: Depends on Kafka cluster latency

### Resource Usage

- **Memory**: ~50-100MB base + ~1KB per active connection
- **CPU**: Low usage, spikes during high message volume
- **Network**: Minimal overhead with efficient Kafka batching

## 🔐 Security Considerations

- Service runs as non-root user in container
- No authentication on TCP port (should be behind firewall)
- Kafka credentials can be configured via environment
- Input validation prevents most injection attacks
- Resource limits prevent denial-of-service

## 📚 Dependencies

### Production Dependencies

- **kafkajs**: Kafka client with modern async/await API
- **prom-client**: Prometheus metrics collection

### Development Dependencies

- **typescript**: Type safety and modern JavaScript features
- **ts-node**: Development execution
- **@types/node**: Node.js type definitions

## 🤝 Contributing

When making changes to the ingestor service:

1. Maintain backward compatibility with message format
2. Add appropriate metrics for new features
3. Update validation rules carefully to avoid data loss
4. Test with realistic message volumes
5. Update documentation for configuration changes

The ingestor service is a critical component in the data pipeline - changes should be thoroughly tested!
