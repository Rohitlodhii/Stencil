"""Auth service — coordinators (pre-seeded) + teachers (register/approve/login).

Colleges tie coordinators to teachers. Postgres (local) stores everything;
tables are created and coordinators seeded on startup.

Run:
  cd apps/auth-service
  uv run uvicorn app.main:app --reload --port 8002
Docs: http://localhost:8002/docs
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlparse

import jwt
import psycopg
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row
from pydantic import BaseModel, EmailStr, Field

# ---- env ----
_HERE = Path(__file__).resolve()
load_dotenv(_HERE.parents[1] / ".env", override=False)
load_dotenv(_HERE.parents[3] / ".env", override=False)

JWT_SECRET = os.getenv("AUTH_JWT_SECRET", "dev-secret-change-me-mponline-32bytes-min")
JWT_ALG = "HS256"
JWT_TTL_HOURS = int(os.getenv("AUTH_JWT_TTL_HOURS", "168"))  # 7 days

DATABASE_URL = os.getenv(
    "AUTH_DATABASE_URL",
    os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/mponline_auth"),
)


def _db_name() -> str:
    try:
        return (urlparse(DATABASE_URL).path or "/?").lstrip("/") or "?"
    except Exception:
        return "?"


# ---- pre-seeded coordinators (cannot self-register) ----
# coordinator_id -> {name, college, password}
SEED_COORDINATORS: list[dict[str, str]] = [
    {
        "coordinator_id": "coord_rgpv",
        "name": "RGPV Coordinator",
        "college": "RGPV Bhopal",
        "password": "coord123",
    },
    {
        "coordinator_id": "coord_davv",
        "name": "DAVV Coordinator",
        "college": "IET DAVV Indore",
        "password": "coord123",
    },
    {
        "coordinator_id": "coord_manit",
        "name": "MANIT Coordinator",
        "college": "MANIT Bhopal",
        "password": "coord123",
    },
]

VALID_STATUSES = ("pending", "approved", "rejected")

# ---- password hashing (stdlib pbkdf2, no extra deps) ----
_ITERATIONS = 200_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, hexhash = stored.split("$")
        assert algo == "pbkdf2_sha256"
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iters))
        return hmac.compare_digest(dk.hex(), hexhash)
    except Exception:
        return False


# ---- db ----
@contextmanager
def get_db() -> Iterator[psycopg.Connection]:
    """Per-operation Postgres connection (dict rows, commit-on-clean-exit)."""
    try:
        conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    except psycopg.OperationalError as exc:
        first_line = str(exc).strip().splitlines()[0][:200]
        raise HTTPException(status_code=503, detail=f"database unreachable: {first_line}")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def ensure_database() -> None:
    """Create the target database if it does not exist yet."""
    target = _db_name()
    try:
        admin = psycopg.connect(DATABASE_URL, dbname="postgres", autocommit=True)
    except psycopg.OperationalError as exc:
        first_line = str(exc).strip().splitlines()[0][:200]
        raise RuntimeError(f"cannot reach postgres server: {first_line}")
    try:
        with admin.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (target,))
            if cur.fetchone() is None:
                # identifiers cannot be parameters — name is from our own env var
                cur.execute(f'CREATE DATABASE "{target}"')
    finally:
        admin.close()


def init_db() -> None:
    ensure_database()
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS coordinators (
                id SERIAL PRIMARY KEY,
                coordinator_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                college TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS teachers (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                teacher_id TEXT UNIQUE NOT NULL,
                college TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
            """
        )
        # seed coordinators (idempotent)
        for seed in SEED_COORDINATORS:
            conn.execute(
                "INSERT INTO coordinators (coordinator_id, name, college, password_hash)"
                " VALUES (%s, %s, %s, %s)"
                " ON CONFLICT (coordinator_id) DO NOTHING",
                (
                    seed["coordinator_id"],
                    seed["name"],
                    seed["college"],
                    hash_password(seed["password"]),
                ),
            )


def row_to_dict(row: Any) -> dict[str, Any]:
    return dict(row)


# ---- jwt ----
def make_token(payload: dict[str, Any]) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=JWT_TTL_HOURS)
    return jwt.encode({**payload, "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="invalid token")


def require_bearer(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return decode_token(authorization.split(" ", 1)[1].strip())


def require_coordinator(claims: dict[str, Any] = Depends(require_bearer)) -> dict[str, Any]:
    if claims.get("role") != "coordinator":
        raise HTTPException(status_code=403, detail="coordinator only")
    return claims


# ---- models ----
class TeacherRegisterRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    teacher_id: str = Field(min_length=2, max_length=60)
    college: str = Field(min_length=2, max_length=160)


class TeacherLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class CoordinatorLoginRequest(BaseModel):
    coordinator_id: str = Field(min_length=2, max_length=60)
    password: str = Field(min_length=1)


class DecisionRequest(BaseModel):
    decision: str = Field(description="'approved' | 'rejected'")


class AuthUser(BaseModel):
    role: str
    name: str
    college: str
    email: str | None = None
    coordinator_id: str | None = None
    teacher_id: str | None = None
    status: str | None = None


class AuthResponse(BaseModel):
    token: str
    user: AuthUser


# ---- app ----
app = FastAPI(title="MPOnline Auth Service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


def known_colleges() -> list[str]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT DISTINCT college FROM coordinators ORDER BY college"
        ).fetchall()
        return [r["college"] for r in rows]


@app.get("/")
async def root():
    return {
        "service": "mponline-auth-service",
        "docs": "/docs",
        "db_backend": "postgres",
        "db_name": _db_name(),
        "colleges": known_colleges(),
    }


@app.get("/health")
async def health():
    try:
        with get_db() as conn:
            conn.execute("SELECT 1").fetchone()
        db_ok = True
    except Exception:
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "db_ok": db_ok,
        "db_backend": "postgres",
        "db_name": _db_name(),
    }


@app.get("/auth/colleges")
async def colleges():
    return {"colleges": known_colleges()}


@app.get("/auth/seeded-coordinators")
async def seeded_coordinators():
    """Demo helper: list coordinator ids + colleges (no password hashes)."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT coordinator_id, name, college FROM coordinators ORDER BY coordinator_id"
        ).fetchall()
        return {"coordinators": [row_to_dict(r) for r in rows]}


@app.post("/auth/teacher/register")
async def teacher_register(body: TeacherRegisterRequest):
    email = body.email.strip().lower()
    college = body.college.strip()
    if college not in known_colleges():
        raise HTTPException(
            status_code=422,
            detail=f"unknown college '{college}'. Choose one of: {', '.join(known_colleges())}",
        )
    try:
        with get_db() as conn:
            exists = conn.execute(
                "SELECT id FROM teachers WHERE email = %s OR teacher_id = %s",
                (email, body.teacher_id.strip()),
            ).fetchone()
            if exists:
                raise HTTPException(
                    status_code=409, detail="email or teacher id already registered"
                )
            row = conn.execute(
                "INSERT INTO teachers (name, email, teacher_id, college, password_hash, status)"
                " VALUES (%s, %s, %s, %s, %s, 'pending') RETURNING id",
                (
                    body.name.strip(),
                    email,
                    body.teacher_id.strip(),
                    college,
                    hash_password(body.password),
                ),
            ).fetchone()
            teacher_db_id = row["id"]
    except psycopg.errors.UniqueViolation:
        raise HTTPException(status_code=409, detail="email or teacher id already registered")
    return {
        "teacher_id_pk": teacher_db_id,
        "status": "pending",
        "message": "registered. Waiting for your college coordinator to approve.",
    }


@app.post("/auth/teacher/login", response_model=AuthResponse)
async def teacher_login(body: TeacherLoginRequest):
    email = body.email.strip().lower()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM teachers WHERE email = %s", (email,)).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid email or password")
    status = row["status"]
    if status == "pending":
        raise HTTPException(status_code=403, detail="pending_approval")
    if status == "rejected":
        raise HTTPException(status_code=403, detail="banned")
    token = make_token(
        {
            "role": "teacher",
            "email": row["email"],
            "name": row["name"],
            "college": row["college"],
            "teacher_id": row["teacher_id"],
            "status": status,
        }
    )
    return AuthResponse(
        token=token,
        user=AuthUser(
            role="teacher",
            name=row["name"],
            college=row["college"],
            email=row["email"],
            teacher_id=row["teacher_id"],
            status=status,
        ),
    )


@app.post("/auth/coordinator/login", response_model=AuthResponse)
async def coordinator_login(body: CoordinatorLoginRequest):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM coordinators WHERE coordinator_id = %s",
            (body.coordinator_id.strip(),),
        ).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid coordinator id or password")
    token = make_token(
        {
            "role": "coordinator",
            "coordinator_id": row["coordinator_id"],
            "name": row["name"],
            "college": row["college"],
        }
    )
    return AuthResponse(
        token=token,
        user=AuthUser(
            role="coordinator",
            name=row["name"],
            college=row["college"],
            coordinator_id=row["coordinator_id"],
        ),
    )


@app.get("/auth/me")
async def me(claims: dict[str, Any] = Depends(require_bearer)):
    return {"user": claims}


@app.get("/auth/coordinator/requests")
async def coordinator_requests(
    status: str = "pending", claims: dict[str, Any] = Depends(require_coordinator)
):
    status = status.strip().lower()
    if status not in ("pending", "approved", "rejected", "all"):
        raise HTTPException(status_code=422, detail="status must be pending|approved|rejected|all")
    with get_db() as conn:
        if status == "all":
            rows = conn.execute(
                "SELECT id, name, email, teacher_id, college, status, created_at FROM teachers"
                " WHERE college = %s ORDER BY created_at DESC",
                (claims["college"],),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, email, teacher_id, college, status, created_at FROM teachers"
                " WHERE college = %s AND status = %s ORDER BY created_at DESC",
                (claims["college"], status),
            ).fetchall()
        return {"college": claims["college"], "requests": [row_to_dict(r) for r in rows]}


@app.post("/auth/coordinator/requests/{teacher_db_id}/decision")
async def decide_request(
    teacher_db_id: int, body: DecisionRequest, claims: dict[str, Any] = Depends(require_coordinator)
):
    decision = body.decision.strip().lower()
    if decision not in ("approved", "rejected"):
        raise HTTPException(status_code=422, detail="decision must be 'approved' or 'rejected'")
    with get_db() as conn:
        row = conn.execute("SELECT * FROM teachers WHERE id = %s", (teacher_db_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="teacher request not found")
        if row["college"] != claims["college"]:
            raise HTTPException(status_code=403, detail="not your college")
        conn.execute("UPDATE teachers SET status = %s WHERE id = %s", (decision, teacher_db_id))
        return {"teacher_db_id": teacher_db_id, "email": row["email"], "status": decision}
