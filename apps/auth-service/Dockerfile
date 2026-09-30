FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/auth

COPY pyproject.toml ./
RUN pip install --upgrade pip \
  && pip install "fastapi>=0.116.0" "uvicorn>=0.34.0" "pydantic>=2.11.0" \
     "email-validator>=2.0.0" "psycopg[binary]>=3.1.0" "pyjwt>=2.8.0" \
     "python-dotenv>=1.0.0" "python-multipart>=0.0.32"

COPY app ./app

EXPOSE 8002

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8002"]
