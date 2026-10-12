# ==============================================================================
# Dockerfile: Full-Stack Express + Vite Application for Render
# Project: itissimple-security-staging (Firestore database: (default))
# Runtime: Node.js 22 LTS (Alpine Linux)
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

# Build production bundle into /app/dist
RUN npm run build

# Stage 2: Runtime image for Node.js, Express, TypeScript (tsx) and static hosting
FROM node:22-alpine AS runner

WORKDIR /app

# Set production environment and staging target configuration
ENV NODE_ENV=production
ENV FIREBASE_PROJECT_ID=itissimple-security-staging
ENV FIREBASE_DATABASE_ID=(default)

# Render provides the PORT environment variable dynamically (defaults to 10000 on Render)
ENV PORT=10000

# Install production dependencies and TypeScript execution engine (tsx)
COPY package.json bun.lock* ./
RUN npm install --omit=dev --legacy-peer-deps && npm install tsx typescript --legacy-peer-deps

# Copy built frontend assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend server entrypoints, configuration, and source files
COPY server.ts ./
COPY serverApp.ts ./
COPY firebase-applet-config.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY privacy.html ./

# Configure non-root node user permissions
RUN chown -R node:node /app

USER node

# Expose Render standard port
EXPOSE 10000

# Health check against API health check endpoint using dynamic PORT
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

# Start full-stack server using the configured start script
CMD ["node", "server.ts"]
