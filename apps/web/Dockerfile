FROM node:22-alpine AS builder

RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/package.json
RUN corepack pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
RUN corepack pnpm --filter web build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --from=builder --chown=appuser:appgroup /workspace/apps/web/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /workspace/apps/web/.next/static ./apps/web/.next/static

USER appuser
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
