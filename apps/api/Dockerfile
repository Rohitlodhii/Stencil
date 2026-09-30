FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.12.20 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# This Dockerfile deliberately uses the repository root as its build context.
# The Python projects form one uv workspace and share the root lockfile.
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/auth-service/pyproject.toml apps/auth-service/pyproject.toml
COPY apps/gateway/pyproject.toml apps/gateway/pyproject.toml
RUN uv sync --frozen --no-dev --package api --no-install-workspace

COPY apps/api/app apps/api/app
COPY apps/api/src apps/api/src
RUN uv sync --locked --no-dev --package api --no-editable

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

WORKDIR /app/apps/api
EXPOSE 8001

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001}"]
