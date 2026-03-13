# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Builder
# Compiles TypeScript and installs production dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first for Docker layer caching
COPY package*.json ./
COPY tsconfig*.json ./
COPY nest-cli.json ./

# Install all deps (dev included for build)
RUN npm ci

# Copy source and build
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install dumb-init for proper signal forwarding and PID 1 handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001 -G nodejs

WORKDIR /app

# Copy built artifacts and production deps from builder
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

# Switch to non-root user
USER nestjs

# Expose application port
EXPOSE 3000

# Health check — hits the /health endpoint (add this endpoint to your app)
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Use dumb-init to handle SIGTERM properly for graceful shutdown
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
