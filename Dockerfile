FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Render must use the repository root as the Docker build context. All Python
# services share this workspace manifest and lockfile.
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/auth-service/pyproject.toml apps/auth-service/pyproject.toml
COPY apps/gateway/pyproject.toml apps/gateway/pyproject.toml
RUN uv sync --frozen --no-dev --package api --no-install-workspace

# Keep every workspace service in the image context so the lockfile and package
# metadata cannot drift between local and Render builds.
COPY apps/api apps/api
COPY apps/auth-service apps/auth-service
COPY apps/gateway apps/gateway
RUN uv sync --locked --no-dev --package api --no-editable

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

WORKDIR /app/apps/api
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('PORT', '8001') + '/health', timeout=8)"

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
