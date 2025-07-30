# Trade Pulse Snapshot Service

The Snapshot Service is a critical component of the Trade Pulse Tracker system that maintains current price state and serves real-time data to clients through REST API and WebSocket connections.

## 🎯 Purpose

This service acts as the bridge between the Kafka message stream and client applications, providing:

- **Current Price State**: Maintains the latest price for each symbol in PostgreSQL
- **REST API**: HTTP endpoints for querying current snapshots
- **WebSocket Streaming**: Real-time price updates to subscribed clients
- **Low-Latency Design**: Optimized database operations and efficient broadcasting

## 🏗️ Architecture

```
Kafka Topic → Kafka Consumer → PostgreSQL Database
                    ↓
              WebSocket Server → Connected Clients
                    ↓
               REST API Server → HTTP Clients
```

### Core Components

1. **Kafka Consumer** (`kafka-consumer.ts`)

   - Consumes price tick messages from Kafka
   - Handles reconnection and error recovery
   - Processes messages with configurable batch sizes

2. **PostgreSQL Updater** (`postgres-updater.ts`)

   - Performs efficient upsert operations
   - Batches updates for optimal performance
   - Maintains connection pooling

3. **REST API** (`rest-api.ts`)

   - HTTP endpoints for snapshot queries
   - CORS support for web clients
   - Comprehensive error handling

4. **WebSocket Server** (`websocket-server.ts`)
   - Real-time price streaming
   - Client subscription management
   - Automatic heartbeat and cleanup

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database with `price_snapshots` table
- Kafka cluster with `price-ticks` topic
- TypeScript (for development)

### Installation

```bash
npm install
```

### Build

```bash
npm run build
```

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

## ⚙️ Configuration

Configure the service using environment variables:

### Kafka Configuration

- `KAFKA_BROKERS`: Comma-separated list of Kafka brokers (default: `kafka:29092`)
- `KAFKA_TOPIC`: Topic to consume from (default: `price-ticks`)
- `KAFKA_GROUP_ID`: Consumer group ID (default: `snapshot-service-group`)
- `KAFKA_CLIENT_ID`: Kafka client identifier (default: `trade-pulse-snapshot-service`)

### PostgreSQL Configuration

- `POSTGRES_HOST`: Database host (default: `postgres`)
- `POSTGRES_PORT`: Database port (default: `5432`)
- `POSTGRES_DATABASE`: Database name (default: `tradepulse`)
- `POSTGRES_USER`: Database user (default: `tradepulse`)
- `POSTGRES_PASSWORD`: Database password (default: `tradepulse123`)
- `POSTGRES_MAX_CONNECTIONS`: Connection pool size (default: `20`)

### API Configuration

- `REST_API_PORT`: REST API port (default: `3001`)
- `REST_API_HOST`: REST API bind address (default: `0.0.0.0`)
- `WEBSOCKET_PORT`: WebSocket server port (default: `3002`)
- `WEBSOCKET_HOST`: WebSocket bind address (default: `0.0.0.0`)

### Metrics Configuration

- `METRICS_ENABLED`: Enable Prometheus metrics (default: `true`)
- `METRICS_PORT`: Metrics server port (default: `9091`)
- `METRICS_PATH`: Metrics endpoint path (default: `/metrics`)

### Performance Configuration

- `BATCH_SIZE`: Database batch size (default: `50`)
- `FLUSH_INTERVAL`: Batch flush interval in ms (default: `1000`)
- `MAX_RETRIES`: Maximum retry attempts (default: `3`)

## 📡 API Endpoints

### REST API (Port 3001)

#### Get All Snapshots

```
GET /api/snapshots
```

Returns all current price snapshots.

#### Get Snapshot by Symbol

```
GET /api/snapshots/:symbol
```

Returns the current snapshot for a specific symbol.

#### Query Multiple Snapshots

```
POST /api/snapshots/query
Content-Type: application/json

{
  "symbols": ["AAPL", "GOOGL", "MSFT"]
}
```

Returns snapshots for the specified symbols.

#### Service Statistics

```
GET /api/stats
```

Returns service and database statistics.

#### Health Check

```
GET /health
```

Returns service health status.

### WebSocket API (Port 3002)

#### Connect

```javascript
const ws = new WebSocket("ws://localhost:3002");
```

#### Subscribe to Symbol Updates

```javascript
ws.send(
	JSON.stringify({
		type: "subscribe",
		symbol: "AAPL",
		timestamp: Date.now(),
	})
);
```

#### Subscribe to Multiple Symbols

```javascript
ws.send(
	JSON.stringify({
		type: "subscribe",
		symbols: ["AAPL", "GOOGL", "MSFT"],
		timestamp: Date.now(),
	})
);
```

#### Unsubscribe

```javascript
ws.send(
	JSON.stringify({
		type: "unsubscribe",
		symbol: "AAPL",
		timestamp: Date.now(),
	})
);
```

#### Receive Price Updates

```javascript
ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (message.type === "price_update") {
		console.log("Price update:", message.data);
	}
};
```

## 📊 Monitoring

### Prometheus Metrics (Port 9091)

- **Endpoint**: `GET /metrics`
- **Health Check**: `GET /health`

### Key Metrics

- Kafka messages processed/errors
- Database operations success/errors
- WebSocket connections and messages
- REST API requests and errors
- Service uptime

## 🐳 Docker

### Build Image

```bash
docker build -t trade-pulse-snapshot-service .
```

### Run Container

```bash
docker run -p 3001:3001 -p 3002:3002 -p 9091:9091 \
  -e KAFKA_BROKERS=kafka:29092 \
  -e POSTGRES_HOST=postgres \
  trade-pulse-snapshot-service
```

## 🔧 Database Schema

The service requires a `price_snapshots` table:

```sql
CREATE TABLE price_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    timestamp BIGINT NOT NULL,
    volume DECIMAL(20, 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(symbol)
);

CREATE INDEX idx_price_snapshots_symbol ON price_snapshots(symbol);
CREATE INDEX idx_price_snapshots_timestamp ON price_snapshots(timestamp);
```

## 🚨 Error Handling

The service implements comprehensive error handling:

- **Kafka**: Automatic reconnection with exponential backoff
- **Database**: Connection pooling with retry logic
- **WebSocket**: Client cleanup and heartbeat monitoring
- **REST API**: Proper HTTP status codes and error messages

## 🔒 Security Features

- Non-root container execution
- Input validation and sanitization
- CORS configuration for web clients
- Connection limits and timeouts
- Graceful shutdown handling

## 🔍 Debugging

### Enable Development Mode

```bash
NODE_ENV=development npm run dev
```

### View Logs

- Kafka message processing logs
- Database operation status
- WebSocket connection events
- REST API request logs

## 📈 Performance Tuning

### Database Optimization

- Adjust `BATCH_SIZE` for optimal throughput
- Tune `FLUSH_INTERVAL` for latency vs. throughput
- Configure `POSTGRES_MAX_CONNECTIONS` based on load

### WebSocket Optimization

- Monitor connection counts and cleanup
- Adjust heartbeat intervals for network conditions

### Kafka Optimization

- Configure consumer groups for scalability
- Tune batch processing parameters

## 🤝 Integration

This service integrates with:

- **Ingestor Service**: Consumes validated price ticks from Kafka
- **Monitoring Service**: Provides metrics endpoints
- **Web Frontend**: Serves real-time data via WebSocket
- **PostgreSQL**: Stores current price snapshots
- **Grafana**: Visualizes service metrics
