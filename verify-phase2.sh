#!/bin/bash

# Phase 2 Verification Script for Monitoring Service
# This script verifies that the monitoring service is working correctly

set -e

echo "🔍 Phase 2: Monitoring Service Verification"
echo "==========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    if [ "$status" == "OK" ]; then
        echo -e "${GREEN}✓${NC} $message"
    elif [ "$status" == "WARN" ]; then
        echo -e "${YELLOW}⚠${NC} $message"
    else
        echo -e "${RED}✗${NC} $message"
    fi
}

# Function to check if container is running
check_container() {
    local container_name=$1
    if docker ps --format "table {{.Names}}" | grep -q "^${container_name}$"; then
        return 0
    else
        return 1
    fi
}

# Function to check container health
check_health() {
    local container_name=$1
    local health=$(docker inspect --format='{{.State.Health.Status}}' $container_name 2>/dev/null || echo "no-health-check")
    if [ "$health" == "healthy" ] || [ "$health" == "no-health-check" ]; then
        return 0
    else
        return 1
    fi
}

echo
echo "1. Checking Infrastructure Services..."
echo "-------------------------------------"

# Check Kafka
if check_container "kafka" && check_health "kafka"; then
    print_status "OK" "Kafka is running and healthy"
else
    print_status "FAIL" "Kafka is not running or unhealthy"
fi

# Check PostgreSQL
if check_container "postgres" && check_health "postgres"; then
    print_status "OK" "PostgreSQL is running and healthy"
else
    print_status "FAIL" "PostgreSQL is not running or unhealthy"
fi

# Check InfluxDB
if check_container "influxdb" && check_health "influxdb"; then
    print_status "OK" "InfluxDB is running and healthy"
else
    print_status "FAIL" "InfluxDB is not running or unhealthy"
fi

# Check Grafana
if check_container "grafana" && check_health "grafana"; then
    print_status "OK" "Grafana is running and healthy"
else
    print_status "FAIL" "Grafana is not running or unhealthy"
fi

echo
echo "2. Checking Monitoring Service..."
echo "--------------------------------"

# Check if monitoring service is running
if check_container "monitoring-service"; then
    print_status "OK" "Monitoring Service container is running"
    
    # Check service logs for successful startup
    echo "   Checking service logs..."
    if docker logs monitoring-service 2>&1 | grep -q "Monitoring Service is running"; then
        print_status "OK" "Monitoring Service started successfully"
    else
        print_status "WARN" "Monitoring Service may still be starting up"
    fi
    
    # Check if service is probing targets
    if docker logs monitoring-service 2>&1 | grep -q "Probing.*targets"; then
        print_status "OK" "Monitoring Service is probing targets"
    else
        print_status "WARN" "No probing activity detected yet"
    fi
else
    print_status "FAIL" "Monitoring Service container is not running"
fi

echo
echo "3. Testing InfluxDB Connection..."
echo "--------------------------------"

# Test InfluxDB connectivity
if curl -s http://localhost:8086/health > /dev/null; then
    print_status "OK" "InfluxDB API is accessible"
    
    # Check if metrics bucket exists
    if docker exec influxdb influx bucket list --token tradepulse-super-secret-auth-token --org tradepulse | grep -q "metrics"; then
        print_status "OK" "Metrics bucket exists in InfluxDB"
    else
        print_status "WARN" "Metrics bucket may not be created yet"
    fi
else
    print_status "FAIL" "InfluxDB API is not accessible"
fi

echo
echo "4. Testing Metrics Collection..."
echo "-------------------------------"

# Wait a bit for metrics to be collected
echo "   Waiting 60 seconds for metrics collection..."
sleep 60

# Check if metrics are being written to InfluxDB
if docker exec influxdb influx query --token tradepulse-super-secret-auth-token --org tradepulse 'from(bucket:"metrics") |> range(start: -5m) |> filter(fn: (r) => r._measurement == "http_probe") |> count()' 2>/dev/null | grep -q "_value"; then
    print_status "OK" "Metrics are being written to InfluxDB"
    
    # Show sample metrics
    echo "   Sample metrics from last 5 minutes:"
    docker exec influxdb influx query --token tradepulse-super-secret-auth-token --org tradepulse 'from(bucket:"metrics") |> range(start: -5m) |> filter(fn: (r) => r._measurement == "http_probe") |> filter(fn: (r) => r._field == "latency_ms") |> last()' 2>/dev/null | head -10
else
    print_status "WARN" "No metrics found in InfluxDB yet (may need more time)"
fi

echo
echo "5. Testing Grafana Integration..."
echo "--------------------------------"

# Test Grafana accessibility
if curl -s http://localhost:3000/api/health > /dev/null; then
    print_status "OK" "Grafana is accessible"
    
    # Check if InfluxDB datasource is configured
    if curl -s -u admin:admin http://localhost:3000/api/datasources | grep -q "InfluxDB-TradePulse"; then
        print_status "OK" "InfluxDB datasource is configured in Grafana"
    else
        print_status "WARN" "InfluxDB datasource may not be configured"
    fi
else
    print_status "FAIL" "Grafana is not accessible"
fi

echo
echo "6. Testing Standalone Mode..."
echo "----------------------------"

# Test if standalone docker-compose works
cd packages/monitoring-service
if [ -f "docker-compose.standalone.yml" ]; then
    print_status "OK" "Standalone docker-compose file exists"
    
    # Validate the compose file
    if docker compose -f docker-compose.standalone.yml config > /dev/null 2>&1; then
        print_status "OK" "Standalone docker-compose file is valid"
    else
        print_status "FAIL" "Standalone docker-compose file has errors"
    fi
else
    print_status "FAIL" "Standalone docker-compose file is missing"
fi
cd ../..

echo
echo "7. Service Detachability Test..."
echo "-------------------------------"

# Check if the service can be extracted
if [ -d "packages/monitoring-service" ]; then
    print_status "OK" "Monitoring service is in separate directory"
    
    # Check for required files
    required_files=("package.json" "Dockerfile" "README.md" "docker-compose.standalone.yml")
    for file in "${required_files[@]}"; do
        if [ -f "packages/monitoring-service/$file" ]; then
            print_status "OK" "Required file exists: $file"
        else
            print_status "FAIL" "Missing required file: $file"
        fi
    done
else
    print_status "FAIL" "Monitoring service directory not found"
fi

echo
echo "📊 Verification Summary"
echo "======================"
echo
echo "The monitoring service should now be:"
echo "• Probing configured HTTP endpoints every 30 seconds"
echo "• Measuring latency with microsecond precision"
echo "• Writing metrics to InfluxDB"
echo "• Available for extraction as a standalone service"
echo
echo "You can:"
echo "• View metrics in Grafana: http://localhost:3000 (admin/admin)"
echo "• Check service logs: docker logs monitoring-service"
echo "• Monitor InfluxDB: http://localhost:8086"
echo
echo "To test the standalone mode:"
echo "  cd packages/monitoring-service"
echo "  docker compose -f docker-compose.standalone.yml up -d"
echo
print_status "OK" "Phase 2 verification complete!"
