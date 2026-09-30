FROM node:22-alpine AS frontend

RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/desktop/package.json apps/desktop/package.json
RUN corepack pnpm install --frozen-lockfile --filter desktop...
COPY apps/desktop apps/desktop
RUN corepack pnpm --filter desktop build

FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH" \
    STENCIL_WEB_DIST=/app/web

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/auth-service/pyproject.toml apps/auth-service/pyproject.toml
COPY apps/gateway/pyproject.toml apps/gateway/pyproject.toml
RUN uv sync --frozen --no-dev --package gateway --no-install-workspace

COPY apps/gateway/app apps/gateway/app
RUN uv sync --locked --no-dev --package gateway --no-editable
COPY --from=frontend /workspace/apps/desktop/dist /app/web

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

WORKDIR /app/apps/gateway
EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
