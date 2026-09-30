import re

with open('e:/mponline/apps/api/app/main.py', 'r') as f:
    content = f.read()

# 1. Add CORS_ORIGINS after SCANNER_SERVICE_URL
old = 'SCANNER_SERVICE_URL = os.getenv("SCANNER_URL", "http://127.0.0.1:8000").rstrip("/")'
new = '''SCANNER_SERVICE_URL = os.getenv("SCANNER_URL", "http://127.0.0.1:8000").rstrip("/")

# CORS origins: comma-separated list, default to localhost:3000 for local dev
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000")
ALLOWED_ORIGINS = [origin.strip() for origin in CORS_ORIGINS.split(",")]'''
content = content.replace(old, new)

# 2. Keep S3_BUCKET and AWS_REGION as is (they already read from env with defaults)

with open('e:/mponline/apps/api/app/main.py', 'w') as f:
    f.write(content)
print('Done')