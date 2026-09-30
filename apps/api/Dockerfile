FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# OpenCV / PyMuPDF runtime libs (headless-safe)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/api

# Install deps first (better layer caching)
COPY pyproject.toml ./
RUN pip install --upgrade pip \
  && pip install "fastapi>=0.116.0" "uvicorn>=0.34.0" "pydantic>=2.11.0" \
     "python-dotenv>=1.0.0" "python-multipart>=0.0.32" \
     "psycopg[binary]>=3.1.0" "boto3>=1.40.0" \
     "openai>=1.0.0" "langchain>=0.3.0" "langchain-core>=0.3.0" "langchain-openai>=0.3.0" \
     "numpy>=2.0.0" "opencv-python-headless>=4.8.0" "pillow>=11.0.0" "pymupdf>=1.24.0" \
     "httpx>=0.28.0" "email-validator>=2.0.0" "pyjwt>=2.8.0"

# App code: exam backend (app/) + scanner package (src/sheet_scanner)
COPY app ./app
COPY src ./src

ENV PYTHONPATH=/srv/api/src:/srv/api

EXPOSE 8000 8001

# Default = exam backend. Compose overrides command for the scanner.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
