# ==============================================================================
# Dockerfile: Dedicated Express Backend for Google Cloud Run
# Project: itissimple-security-staging
# Runtime: Node.js 22 LTS (Alpine Linux)
# ==============================================================================

FROM node:22-alpine AS runtime

# Set container working directory
WORKDIR /app

# Ensure production environment & strictly bound Firebase staging project
ENV NODE_ENV=production
ENV STANDALONE_BACKEND=true
ENV FIREBASE_PROJECT_ID=itissimple-security-staging
ENV FIREBASE_DATABASE_ID=(default)
ENV PORT=8080
# Operational mode: setting DIAGNOSTIC_ONLY=true boots exclusively src/diagnosticApp.ts
ENV DIAGNOSTIC_ONLY=true

# Install dependencies needed for production execution
COPY package.json package*.json bun.lock* ./

# Install production dependencies and tsx loader for TypeScript execution
# Uses legacy-peer-deps to prevent peer dependency resolution errors
RUN npm install --omit=dev --legacy-peer-deps && npm install tsx typescript --legacy-peer-deps

# Copy server code and configuration
COPY server.ts ./
COPY serverApp.ts ./
COPY firebase-applet-config.json ./
COPY src/ ./src/

# Run as non-privileged node user for security hardening
USER node

# Expose default Cloud Run container port
EXPOSE 8080

# Health check against dedicated API health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

# Start dedicated Express backend server
CMD ["node", "server.ts"]
