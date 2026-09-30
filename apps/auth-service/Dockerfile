FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/auth-service/pyproject.toml apps/auth-service/pyproject.toml
COPY apps/gateway/pyproject.toml apps/gateway/pyproject.toml
RUN uv sync --frozen --no-dev --package auth-service --no-install-workspace

COPY apps/auth-service/app apps/auth-service/app
RUN uv sync --locked --no-dev --package auth-service --no-editable

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

WORKDIR /app/apps/auth-service
EXPOSE 8002

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8002}"]
