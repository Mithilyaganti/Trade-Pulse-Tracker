# Tick Generator - Phase 3

A flexible financial price tick generator that supports CSV replay and live Binance WebSocket data relay. This service is part of the Trade Pulse Tracker project and feeds price data to ingestor services via TCP.

## Features

### 🎬 CSV Replay

- **Stooq Format Support**: Process CSV files in Stooq format (Date,Time,Open,High,Low,Close,Volume)
- **Configurable Speed**: Replay at real-time (1x) or accelerated speeds (2x, 10x, etc.)
- **Loop Playback**: Continuously replay CSV data for extended testing
- **Progress Tracking**: Real-time progress reporting during playback

### 🌐 Binance WebSocket Relay

- **Real-time Data**: Connect to Binance's live WebSocket streams
- **Multiple Symbols**: Monitor multiple cryptocurrency pairs simultaneously
- **Automatic Reconnection**: Resilient connection handling with exponential backoff
- **Rate Monitoring**: Track throughput and connection statistics

### 🔌 TCP Delivery

- **Reliable Transport**: TCP connection to ingestor services
- **Message Queuing**: Queue messages during connection interruptions
- **Auto-reconnection**: Automatic reconnection with configurable retry logic
- **Connection Monitoring**: Real-time connection status and queue size tracking

## Data Format

### Input Formats

**CSV (Stooq Format)**:

```csv
Date,Time,Open,High,Low,Close,Volume
2024-01-15,09:30:00,150.25,150.75,150.10,150.60,1000000
```

**Binance WebSocket**: Automatically processed from Binance's ticker stream format.

### Output Format (TCP)

Price ticks are sent as pipe-delimited strings:

```
RIC|PRICE|TIMESTAMP|VOLUME|BID|ASK
AAPL.O|150.60|1705323000000|1000000|150.10|150.75
```

## Usage

### Command Line Interface

#### CSV Replay

```bash
# Basic CSV replay
npm run dev -- --source=csv --file=./data/AAPL.csv

# Accelerated playback (2x speed)
npm run dev -- --source=csv --file=./data/AAPL.csv --speed=2.0

# Looped playback
npm run dev -- --source=csv --file=./data/AAPL.csv --loop

# Custom TCP target
npm run dev -- --source=csv --file=./data/AAPL.csv --host=ingestor --port=8080
```

#### Binance WebSocket Relay

```bash
# Single symbol
npm run dev -- --source=binance --symbols=BTCUSDT

# Multiple symbols
npm run dev -- --source=binance --symbols=BTCUSDT,ETHUSDT,BNBUSDT

# With custom target
npm run dev -- --source=binance --symbols=BTCUSDT --host=ingestor --port=8080
```

### Docker Usage

```bash
# Build the image
docker build -t tick-generator .

# CSV replay
docker run --rm -v $(pwd)/data:/app/data tick-generator \
  node dist/index.js --source=csv --file=/app/data/AAPL.csv

# Binance relay
docker run --rm tick-generator \
  node dist/index.js --source=binance --symbols=BTCUSDT,ETHUSDT
```

### Programmatic Usage

```typescript
import { TickGenerator, DataSource } from "./src";

const generator = new TickGenerator({
	source: DataSource.CSV,
	file: "./data/AAPL.csv",
	speed: 1.0,
	host: "localhost",
	port: 8080,
});

await generator.start();
```

## Configuration Options

| Option                     | Description                           | Default              | Example                      |
| -------------------------- | ------------------------------------- | -------------------- | ---------------------------- |
| `--source`                 | Data source type (csv or binance)     | Required             | `--source=csv`               |
| `--file`                   | CSV file path (csv source only)       | Required for CSV     | `--file=./data/AAPL.csv`     |
| `--symbols`                | Binance symbols (binance source only) | Required for Binance | `--symbols=BTCUSDT,ETHUSDT`  |
| `--speed`                  | CSV playback speed multiplier         | 1.0                  | `--speed=2.0`                |
| `--loop`                   | Loop CSV playback                     | false                | `--loop`                     |
| `--host`                   | TCP target host                       | localhost            | `--host=ingestor`            |
| `--port`                   | TCP target port                       | 8080                 | `--port=9090`                |
| `--reconnect-interval`     | TCP reconnection interval (ms)        | 5000                 | `--reconnect-interval=10000` |
| `--max-reconnect-attempts` | Max TCP reconnection attempts         | 10                   | `--max-reconnect-attempts=5` |

## Symbol Mapping

### CSV Files

Symbols are automatically mapped from filename to Reuters Instrument Codes (RIC):

- `AAPL.csv` → `AAPL.O`
- `GOOGL.csv` → `GOOGL.O`
- `EURUSD.csv` → `EUR=`

### Binance Symbols

Cryptocurrency pairs are mapped to RIC format:

- `BTCUSDT` → `BTC=`
- `ETHUSDT` → `ETH=`
- `BNBUSDT` → `BNB=`

## Error Handling

### TCP Connection Issues

- Automatic reconnection with exponential backoff
- Message queuing during disconnections
- Configurable retry limits and intervals

### Data Source Issues

- **CSV**: File validation, format verification, graceful error reporting
- **Binance**: WebSocket reconnection, rate limiting handling, API error management

### Graceful Shutdown

- SIGINT/SIGTERM signal handling
- Proper resource cleanup
- Connection closure with pending message delivery

## Monitoring and Statistics

### CSV Replay Statistics

```
📊 Progress: 45.2% (902/2000)
📈 Speed: 2.0x (Real-time equivalent)
⏰ Estimated completion: 00:02:30
```

### Binance Relay Statistics

```
📊 Binance Relay Statistics:
   Total ticks processed: 15,432
   Uptime: 1,247.3 seconds
   Average rate: 12.38 ticks/second
   Symbols monitored: 3
```

### TCP Connection Status

```
🔌 TCP Connection: Connected
📋 Queued messages: 0
🔄 Reconnection attempts: 0/10
```

## Development

### Building

```bash
npm run build      # Compile TypeScript
npm run watch      # Watch mode compilation
npm run clean      # Clean build directory
```

### Running

```bash
npm run dev        # Run with ts-node
npm start          # Run compiled version
```

### Quick Commands

```bash
npm run csv        # Run CSV demo with sample data
npm run binance    # Run Binance demo with BTC/ETH
npm run help       # Show CLI help
```

## Integration with Trade Pulse Tracker

This service is designed to work with:

- **Ingestor Service** (Phase 4): Receives TCP data and forwards to Kafka
- **Monitoring Service** (Phase 2): Can monitor the TCP endpoint health
- **Docker Compose**: Integrated into the main infrastructure stack

### Typical Data Flow

```
CSV File/Binance → Tick Generator → TCP → Ingestor → Kafka → Snapshot Service
```

## Production Considerations

### Performance

- **CSV Replay**: Can handle large files efficiently with streaming processing
- **Binance Relay**: Handles high-frequency updates with automatic backpressure
- **Memory Usage**: Minimal memory footprint with streaming architecture

### Reliability

- **Connection Resilience**: Multiple layers of error handling and reconnection
- **Data Integrity**: Message queuing ensures no data loss during interruptions
- **Monitoring**: Comprehensive logging and statistics for observability

### Security

- **Non-root Container**: Runs as non-privileged user in Docker
- **Input Validation**: Comprehensive validation of CSV data and command arguments
- **Error Isolation**: Proper error boundaries prevent cascading failures

## Troubleshooting

### Common Issues

**"CSV file not found"**

- Verify file path is correct and accessible
- Check file permissions

**"Failed to connect to TCP server"**

- Ensure ingestor service is running
- Verify host/port configuration
- Check network connectivity

**"Binance WebSocket connection failed"**

- Verify internet connectivity
- Check if symbols are valid on Binance
- Review Binance API status

**"Connection keeps dropping"**

- Increase reconnection attempts and interval
- Check network stability
- Monitor target service health

### Debug Mode

Set environment variable for verbose logging:

```bash
DEBUG=tick-generator npm run dev -- [options]
```

## License

MIT License - Part of the Trade Pulse Tracker project.
