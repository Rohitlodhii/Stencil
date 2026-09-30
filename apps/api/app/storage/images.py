"""S3 image storage helper (public-read bucket)."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from dotenv import load_dotenv

_HERE = Path(__file__).resolve()
load_dotenv(_HERE.parents[2] / ".env", override=False)
load_dotenv(_HERE.parents[3] / ".env", override=False)

S3_BUCKET = os.getenv("S3_BUCKET", "mponline-images-398218088339")
AWS_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "ap-south-1"))


def get_s3_client():
    import boto3

    return boto3.client("s3", region_name=AWS_REGION)


def public_s3_url(key: str) -> str:
    return f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{key}"


def upload_bytes_to_s3(data: bytes, content_type: str, ext: str, prefix: str) -> dict:
    day = datetime.now(timezone.utc).strftime("%Y%m%d")
    key = f"{prefix}/{day}/{uuid.uuid4().hex}{ext}"
    s3 = get_s3_client()
    s3.upload_fileobj(BytesIO(data), S3_BUCKET, key, ExtraArgs={"ContentType": content_type})
    return {"url": public_s3_url(key), "key": key, "bucket": S3_BUCKET,
            "region": AWS_REGION, "content_type": content_type, "size_bytes": len(data)}
