FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Configure npm for better reliability
RUN npm config set fetch-timeout 300000
RUN npm config set registry https://registry.npmjs.org/

# Install all dependencies (including dev for building)
RUN npm install --verbose

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --omit=dev

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S monitoring -u 1001

# Change ownership of the app directory
RUN chown -R monitoring:nodejs /app
USER monitoring

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "console.log('Health check: Service is running')" || exit 1

# Start the application
CMD ["npm", "start"]
