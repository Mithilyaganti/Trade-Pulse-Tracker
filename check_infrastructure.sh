#!/bin/bash

echo "🔍 Checking Trade Pulse Tracker Infrastructure Status..."
echo "=================================================="

# Check Docker Compose status
echo ""
echo "📋 Docker Compose Status:"
docker compose ps

echo ""
echo "🔍 Individual Service Health Checks:"

# Check InfluxDB
echo ""
echo "📊 InfluxDB Health:"
if curl -s http://localhost:8086/health >/dev/null; then
    echo "✅ InfluxDB is healthy and ready"
    curl -s http://localhost:8086/health | jq -r '.message' 2>/dev/null || echo "   Ready for queries and writes"
else
    echo "❌ InfluxDB is not responding"
fi

# Check Grafana
echo ""
echo "📈 Grafana Health:"
if curl -s http://localhost:3000/api/health >/dev/null; then
    echo "✅ Grafana is healthy"
    curl -s http://localhost:3000/api/health | jq -r '.version' 2>/dev/null || echo "   Version check available at http://localhost:3000"
else
    echo "❌ Grafana is not responding"
fi

# Check PostgreSQL
echo ""
echo "🗄️  PostgreSQL Health:"
if docker exec postgres psql -U tradepulse -d tradepulse -c "SELECT 1;" >/dev/null 2>&1; then
    echo "✅ PostgreSQL is healthy"
    echo "   Tables: $(docker exec postgres psql -U tradepulse -d tradepulse -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d ' ')"
else
    echo "❌ PostgreSQL is not responding"
fi

# Check Kafka
echo ""
echo "📨 Kafka Health:"
if docker exec kafka kafka-broker-api-versions --bootstrap-server localhost:9092 >/dev/null 2>&1; then
    echo "✅ Kafka is healthy"
    TOPIC_COUNT=$(docker exec kafka kafka-topics --list --bootstrap-server localhost:9092 2>/dev/null | wc -l)
    echo "   Topics: $TOPIC_COUNT"
else
    echo "❌ Kafka is not responding"
fi

# Check Zookeeper
echo ""
echo "🦒 Zookeeper Health:"
if docker exec zookeeper sh -c "timeout 2 nc -z localhost 2181" >/dev/null 2>&1; then
    echo "✅ Zookeeper is healthy"
    echo "   Port 2181 is accepting connections"
else
    echo "❌ Zookeeper is not responding"
fi

echo ""
echo "🌐 Access URLs:"
echo "   Grafana:  http://localhost:3000 (admin/admin)"
echo "   InfluxDB: http://localhost:8086"
echo ""
echo "=================================================="
echo "✅ Phase 1 Infrastructure Setup Complete!"
