FROM node:20-alpine AS builder

# Enable corepack and set pnpm version
RUN corepack enable

WORKDIR /app

# Copy pnpm-workspace.yaml and package files for layer caching
COPY pnpm-workspace.yaml ./
COPY package.json ./

# Install dependencies with frozen lockfile
RUN --mount=type=cache,id=pnpm,target=/pnpm/.store corepack pnpm install --frozen-lockfile

# Copy the rest of the monorepo
COPY . .

# Build only the web app
RUN --mount=type=cache,id=pnpm,target=/pnpm/.store corepack pnpm --filter web build

FROM node:20-alpine AS runtime

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy built outputs from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next-config.json ./

# Set environment defaults
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Expose the port
EXPOSE 3000

# Switch to non-root user
USER appuser

# Start the app
CMD ["node", ".next/standalone/server.js"]