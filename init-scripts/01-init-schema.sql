-- Initialize the Trade Pulse Tracker database schema
-- This script sets up the basic tables for price snapshots

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table for storing current price snapshots
CREATE TABLE IF NOT EXISTS price_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    price DECIMAL(20, 8) NOT NULL,
    timestamp BIGINT NOT NULL,
    volume DECIMAL(20, 8),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(symbol)
);

-- Index for fast symbol lookups
CREATE INDEX IF NOT EXISTS idx_price_snapshots_symbol ON price_snapshots(symbol);

-- Index for timestamp-based queries
CREATE INDEX IF NOT EXISTS idx_price_snapshots_timestamp ON price_snapshots(timestamp);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update the updated_at column
CREATE TRIGGER update_price_snapshots_updated_at 
    BEFORE UPDATE ON price_snapshots 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE tradepulse TO tradepulse;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tradepulse;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO tradepulse;
