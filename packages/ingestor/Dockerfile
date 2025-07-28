# Build stage
FROM node:20-alpine AS builder

# Create app directory
WORKDIR /app

# Copy package files first (Docker layer caching optimization)
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S ingestor -u 1001 -G nodejs

# Change ownership of the app directory
RUN chown -R ingestor:nodejs /app

# Switch to non-root user
USER ingestor

# Expose ports
EXPOSE 8080 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { host: 'localhost', port: 9090, path: '/metrics', timeout: 5000 }; \
    const req = http.request(options, (res) => { \
      if (res.statusCode === 200) { console.log('Health check: OK'); process.exit(0); } \
      else { console.log('Health check: Failed'); process.exit(1); } \
    }); \
    req.on('error', () => { console.log('Health check: Error'); process.exit(1); }); \
    req.end();" || exit 1

# Command to run the application
CMD ["npm", "start"]

# Metadata
LABEL maintainer="Trade Pulse Tracker Team"
LABEL description="TCP price tick ingestor service with Kafka publishing"
LABEL version="1.0.0"
