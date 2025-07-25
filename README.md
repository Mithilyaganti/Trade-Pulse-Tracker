# Trade Pulse Tracker - Phase 1: Foundation Setup

## Overview

This is Phase 1 of the Trade Pulse Tracker implementation. This phase establishes the container environment and basic project structure with all infrastructure services.

## Project Structure

```
Trade-Pulse-Tracker/
├── docker-compose.yml          # Main infrastructure services
├── packages/                   # Future application services
├── web/                       # Future web frontend
├── init-scripts/              # PostgreSQL initialization
│   └── 01-init-schema.sql    # Database schema setup
├── grafana/                   # Grafana configuration
│   ├── provisioning/
│   │   ├── datasources/
│   │   │   └── influxdb.yml   # InfluxDB datasource config
│   │   └── dashboards/
│   │       └── dashboard.yml  # Dashboard provisioning config
│   └── dashboards/           # Custom dashboards (empty for now)
└── README.md                 # This file
```

## Infrastructure Services

### 🚀 Kafka & Zookeeper

- **Kafka**: Message queuing system for decoupled communication
- **Zookeeper**: Required for Kafka coordination
- **Ports**: Kafka (9092), Zookeeper (2181)

### 🗄️ PostgreSQL

- **Purpose**: Stores current price snapshots with low-latency access
- **Port**: 5432
- **Database**: tradepulse
- **User**: tradepulse
- **Password**: tradepulse123

### 📊 InfluxDB

- **Purpose**: Time-series database optimized for latency metrics
- **Port**: 8086
- **Organization**: tradepulse
- **Bucket**: metrics
- **Admin Token**: tradepulse-super-secret-auth-token

### 📈 Grafana

- **Purpose**: Visualizes latency metrics with customizable dashboards
- **Port**: 3000
- **Admin User**: admin
- **Admin Password**: admin

## Getting Started

### Prerequisites

- Docker and Docker Compose installed
- At least 4GB of available RAM
- Ports 2181, 3000, 5432, 8086, 9092 available

### 1. Start Infrastructure Services

```bash
cd /home/mithil/projects/Trade-Pulse-Tracker
docker compose up -d
```

### 2. Verify Services

After all containers are running, verify each service:

#### Check Kafka

```bash
# List Kafka topics (should be empty initially)
docker exec kafka kafka-topics --list --bootstrap-server localhost:9092
```

#### Check PostgreSQL

```bash
# Connect to PostgreSQL
docker exec -it postgres psql -U tradepulse -d tradepulse

# Verify schema (should show price_snapshots table)
\dt
\q
```

#### Check InfluxDB

```bash
# Check InfluxDB health
curl http://localhost:8086/health
```

#### Check Grafana

- Open browser to http://localhost:3000
- Login with admin/admin
- Verify InfluxDB datasource is configured

### 3. Stop Services

```bash
docker compose down
```

### 4. Clean Up (if needed)

```bash
# Remove all data volumes
docker compose down -v
docker volume prune
```

## Health Checks

All services include health checks that ensure:

- Services start in the correct order
- Dependencies are ready before dependent services start
- Easy monitoring of service status

## Network Configuration

- All services run on the `trade-pulse-network` bridge network
- Services can communicate using their container names as hostnames
- External access is provided through exposed ports

## Next Steps (Phase 2)

The next phase will implement the Monitoring Service as a standalone, detachable module that:

- Probes HTTP endpoints for latency measurement
- Writes metrics to InfluxDB
- Can be extracted for use in other projects

## Troubleshooting

### Port Conflicts

If you get port conflicts, check what's using the ports:

```bash
sudo lsof -i :3000 :5432 :8086 :9092 :2181
```

### Memory Issues

If containers fail to start due to memory:

- Increase Docker memory allocation
- Close other applications
- Consider running services individually

### Permission Issues

If you get permission errors with volumes:

```bash
sudo chown -R $USER:$USER .
```

## Phase 1 Deliverable ✅

A working infrastructure stack with:

- ✅ Kafka message broker with Zookeeper
- ✅ PostgreSQL database with price snapshot schema
- ✅ InfluxDB time-series database for metrics
- ✅ Grafana with InfluxDB datasource configured
- ✅ Health checks and proper service dependencies
- ✅ Network isolation and volume persistence
- ✅ Ready for application services in subsequent phases
