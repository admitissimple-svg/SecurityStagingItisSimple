# ==============================================================================
# Dockerfile: Dedicated Isolated Diagnostic Backend for Google Cloud Run
# Project: itissimple-security-staging (Firestore database: (default))
# Runtime: Node.js 22 LTS (Alpine Linux)
# Security Mode: DIAGNOSTIC_ONLY=true (Fail-safe default)
# ==============================================================================

# Stage 1: Build the Vite frontend application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock* ./

# Install all dependencies (including devDependencies required for Vite and Tailwind build)
RUN npm install --legacy-peer-deps

# Copy frontend source files and configuration
COPY vite.config.ts tsconfig.json index.html ./
COPY src/ ./src/
COPY public/ ./public/
COPY firebase-applet-config.json ./

# Ensure local database file is never embedded into build assets
RUN rm -f src/data/app_db.json

# Build production bundle into /app/dist
COPY firebase-applet-config.json ./
RUN npm run build

# Stage 2: Runtime image for Node.js, Express, TypeScript (tsx)
FROM node:22-alpine AS runner

WORKDIR /app

# Set staging target configuration
ENV DIAGNOSTIC_ONLY=true
ENV FIREBASE_PROJECT_ID=itissimple-security-staging
ENV FIREBASE_DATABASE_ID=(default)

# Cloud Run injects PORT dynamically at runtime (defaults to 8080)
ENV PORT=8080

# Install production dependencies and TypeScript execution engine (tsx)
# --include=dev explicitly guarantees tsx and typescript are installed even with devDependencies classification
COPY package.json bun.lock* ./
RUN npm install --omit=dev --legacy-peer-deps && npm install --include=dev tsx typescript --legacy-peer-deps

# Set production environment for runtime
ENV NODE_ENV=production

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend server entrypoints, configuration, and source files
COPY server.ts ./
COPY serverApp.ts ./
COPY firebase-applet-config.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY firebase-applet-config.json ./
COPY privacy.html ./

# Guarantee that local app_db.json and local backups are strictly absent from runner image
RUN rm -f /app/src/data/app_db.json /app/dist/src/data/app_db.json

# Configure non-root node user permissions
RUN chown -R node:node /app

USER node

# Expose standard Cloud Run port
EXPOSE 8080

# Health check against API health check endpoint using dynamic PORT
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

# Direct execution with --import tsx to avoid redundant child process
CMD ["node", "--import", "tsx", "server.ts"]
