# Multi-stage Docker build for Trade Pulse Snapshot Service
# Optimized for production deployment with minimal image size

# Stage 1: Build stage
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ 

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci --include=dev

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Remove dev dependencies to reduce size
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Production stage
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S snapservice -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=snapservice:nodejs /app/dist ./dist
COPY --from=builder --chown=snapservice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=snapservice:nodejs /app/package*.json ./

# Switch to non-root user
USER snapservice

# Expose ports
EXPOSE 3001 3002 9091

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { host: 'localhost', port: 9091, path: '/health', timeout: 5000 }; \
    const req = http.request(options, (res) => { \
      if (res.statusCode === 200) { console.log('Health check: OK'); process.exit(0); } \
      else { console.log('Health check: Failed'); process.exit(1); } \
    }); \
    req.on('error', () => { console.log('Health check: Error'); process.exit(1); }); \
    req.end();" || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]

# Labels for metadata
LABEL maintainer="Trade Pulse Tracker"
LABEL version="1.0.0"
LABEL description="Snapshot service that maintains current price state and serves clients via REST API and WebSocket"
