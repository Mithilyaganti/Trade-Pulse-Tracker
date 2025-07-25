# Project Implementation Plan for Real-Time Price-Feed Ingestor + Latency-Monitoring Dashboard

## 1. Project Purpose & Why It's Being Made

This project creates a production-grade event-driven data pipeline for financial price data with a critical focus on **minimizing and monitoring latency** in trading systems. The core problem it solves is the **lag in trading ticks aggregation** that can lead to:

- Missed trading opportunities
- Stale price information affecting decision-making
- Inability to measure and optimize system performance
- Lack of observability into real-time data flow

Unlike traditional solutions, this system doesn't just process data - it **continuously measures its own latency** at every stage, giving traders and developers precise insights into where delays occur. The modular design ensures that each component can be optimized independently to reduce end-to-end latency from data source to visualization.

## 2. Overall Development Approach

The project will be built using a **modular, containerized architecture** with clear separation of concerns. Key principles:

- **Incremental development**: Build one component at a time, verify functionality, then move to the next
- **Loose coupling**: Services communicate via Kafka, not direct dependencies
- **Observability-first**: Monitoring is built in from the beginning, not added later
- **Container-native**: Everything runs in Docker with clear environment separation
- **Detachability**: The monitoring service can be extracted and used in other projects

## 3. Tech Stack for Each Service

| Service | Tech Stack | Why This Stack |
|---------|------------|----------------|
| **Tick Generator** | Node 20, TypeScript, axios, net | Lightweight, handles both CSV replay and API relay efficiently |
| **Ingestor** | Node 20, TypeScript, kafkajs | Handles high-throughput TCP connections and Kafka publishing |
| **Snapshot Service** | Node 20, TypeScript, express, pg, ws, prom-client | Combines REST API, WebSocket streaming, and database operations |
| **Monitoring Service** | Node 20, TypeScript, axios, influxdb-client, node-cron | Specialized for HTTP probing and metrics collection |
| **Web Frontend** | React 18, Vite, TypeScript, recharts | Modern, fast UI with real-time charting capabilities |
| **Infrastructure** | Kafka, Zookeeper, PostgreSQL, InfluxDB, Grafana | Proven combination for streaming data, relational storage, and time-series metrics |

## 4. Service Descriptions

### Core Data Pipeline Services
- **Tick Generator**: Simulates real market data from CSV files or live APIs (Binance)
- **Ingestor**: Validates and forwards price ticks to Kafka (the central nervous system)
- **Snapshot Service**: Maintains current price state in PostgreSQL and serves to clients

### Observability Services
- **Monitoring Service**: Independently checks system health (designed to be detachable)
- **Grafana**: Visualizes latency metrics with customizable dashboards

### Infrastructure Components
- **Kafka/Zookeeper**: Message queuing system for decoupled communication
- **PostgreSQL**: Stores current price snapshots with low-latency access
- **InfluxDB**: Time-series database optimized for latency metrics

## 5. Sequential Implementation Plan

### Phase 1: Foundation Setup
**Goal**: Establish the container environment and basic project structure

1. Create root directory structure:
   ```
   root/
   ├── docker-compose.yml
   ├── packages/
   │   └── (empty for now)
   └── web/
       └── (empty for now)
   ```

2. Set up the core docker-compose file with infrastructure services only:
   - Kafka
   - Zookeeper
   - PostgreSQL
   - InfluxDB
   - Grafana

3. Verify all infrastructure containers start correctly with:
   ```bash
   docker compose up --build
   ```

*Deliverable: Working infrastructure containers without any application code*

### Phase 2: Monitoring Service (Built for Detachability)
**Goal**: Create the reusable monitoring component first since it's critical for measuring latency

1. Build the monitoring-service as a standalone module:
   ```
   packages/monitoring-service/
   ├── src/
   │   ├── index.ts
   │   ├── probe-manager.ts
   │   └── influx-writer.ts
   ├── Dockerfile
   ├── package.json
   └── docker-compose.standalone.yml
   ```

2. Implement key features:
   - Configurable HTTP endpoint probing via TARGETS environment variable
   - Round-trip-time measurement with high precision
   - InfluxDB line protocol formatting
   - Middleware interface that can work with any project
   - `docker-compose.standalone.yml` for easy extraction

3. Test with mock endpoints to verify metrics flow to InfluxDB and Grafana

*Deliverable: A fully functional monitoring service that can be yanked out and used in any project*

### Phase 3: Tick Generator
**Goal**: Create data sources to feed the system

1. Build the tick-generator:
   ```
   packages/tick-generator/
   ├── src/
   │   ├── csv-replay.ts
   │   ├── binance-relay.ts
   │   └── tcp-sender.ts
   ├── Dockerfile
   └── package.json
   ```

2. Implement both data source options:
   - CSV replay (using Stooq format)
   - Binance WebSocket relay
   - TCP delivery to ingestor port

3. Add CLI flags for easy switching between data sources

*Deliverable: A reliable data generator that simulates real market conditions*

### Phase 4: Ingestor Service
**Goal**: Create the entry point that validates and routes price data

1. Build the ingestor:
   ```
   packages/ingestor/
   ├── src/
   │   ├── server.ts
   │   ├── validator.ts
   │   └── kafka-publisher.ts
   ├── Dockerfile
   └── package.json
   ```

2. Implement:
   - TCP server accepting RIC price ts format
   - Message validation and error handling
   - Kafka publishing with proper partitioning
   - Basic metrics for ingestion rate

3. Connect to Kafka and verify messages appear in the topic

*Deliverable: A robust data entry point that feeds validated ticks to Kafka*

### Phase 5: Snapshot Service
**Goal**: Create the service that maintains current state and serves clients

1. Build the snapshot-service:
   ```
   packages/snapshot-service/
   ├── src/
   │   ├── kafka-consumer.ts
   │   ├── postgres-updater.ts
   │   ├── rest-api.ts
   │   └── websocket-server.ts
   ├── Dockerfile
   └── package.json
   ```

2. Implement:
   - Kafka consumer with proper error handling
   - PostgreSQL upsert operations with low-latency design
   - REST API for current snapshots
   - WebSocket for real-time updates
   - Prometheus metrics endpoint

3. Verify data flows from Kafka to database to API

*Deliverable: A service that maintains current price state and serves it efficiently*

### Phase 6: Web Frontend
**Goal**: Create the user interface for real-time visualization

1. Build the web app:
   ```
   web/
   ├── src/
   │   ├── App.tsx
   │   ├── components/
   │   │   ├── PriceTable.tsx
   │   │   └── LatencyChart.tsx
   │   ├── services/
   │   │   ├── api.ts
   │   │   └── websocket.ts
   ├── Dockerfile
   └── package.json
   ```

2. Implement:
   - Real-time price table using WebSocket connection
   - Latency chart pulling from monitoring service
   - Clean, responsive UI for trading professionals
   - Connection to snapshot service REST and WebSocket

*Deliverable: A professional UI showing live prices and system latency*

### Phase 7: Integration & Optimization
**Goal**: Connect all components and optimize for minimal latency

1. Finalize docker-compose.yml with all services
2. Implement end-to-end testing
3. Add Grafana dashboards for:
   - Ingestion latency
   - Processing latency
   - End-to-end latency
4. Optimize critical paths for minimal delay
5. Add alerting rules for abnormal latency

*Deliverable: A fully integrated system with observability into every latency component*

## 6. Key Implementation Details for Each Phase

### For the Monitoring Service (Phase 2 - Critical for Your Requirements)
- Design the service with a clean middleware interface that can be injected into any project
- Use environment variables for target URLs (TARGETS=http://service1,http://service2)
- Implement the service with minimal dependencies so it can be extracted easily
- The standalone docker-compose file must work without any changes to the main project
- Metrics should follow a standard format that works with any InfluxDB/Grafana setup

### For All Services
- Each service gets its own Dockerfile and package.json
- Use TypeScript for type safety and better maintenance
- Implement proper error handling and retry mechanisms
- Add health check endpoints for Docker
- Use environment variables for all configuration
- Include prometheus-client for metrics where appropriate

## 7. Development Workflow Instructions for Copilot

When implementing this project with an AI copilot:

1. Start with Phase 1 (Foundation Setup) - have the copilot generate the base docker-compose.yml with infrastructure services

2. Once verified working, move to Phase 2 (Monitoring Service) - this is critical for your requirement of a detachable monitoring component

3. Continue sequentially through each phase, testing each component before moving to the next

4. When implementing each phase, request:
   - Complete directory structure
   - Dockerfile configuration
   - Core implementation files
   - Basic tests or verification steps
   - Documentation comments in code

5. For the monitoring service specifically, emphasize:
   - "This must be designed to be extracted as a standalone module"
   - "Implement a clean interface that can be integrated with any project"
   - "Do not hardcode dependencies on other services in this project"

This approach ensures manageable development chunks while maintaining the modularity you require, especially for the monitoring component that needs to be reusable across projects.