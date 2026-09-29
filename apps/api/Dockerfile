FROM python:3.12-slim

# Install uv from Astral
COPY --from=ghcr.io/astral-sh/uv:latest /uv /local/bin/uv
ENV PATH="/local/bin:$PATH"

# Set working directory
WORKDIR /app

# Copy uv.lock first for layer caching
COPY uv.lock ./

# Install dependencies with uv sync --frozen --no-dev
RUN uv sync --frozen --no-dev

# Copy the application code
COPY app ./app

# Create a non-root user
RUN useradd --create-home --shell /bin/bash appuser

# Copy the rest of the source code (src) as the non-root user will own the home dir
COPY src ./src

# Switch to non-root user
USER appuser

# Expose the backend port
EXPOSE 8001

# Run uvicorn without --reload, binding to 0.0.0.0:8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]