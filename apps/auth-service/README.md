# Auth Service (`:8002`)

Coordinators (pre-seeded, no registration) + Teachers (register → coordinator
approval → login). Local **Postgres** database `mponline_auth` (tables created
+ coordinators seeded on startup; the database itself is created too if
missing).

Connection string comes from `AUTH_DATABASE_URL` (`apps/auth-service/.env`,
gitignored):

```text
AUTH_DATABASE_URL=postgresql://postgres:<password>@localhost:5432/mponline_auth
```

```bash
cd apps/auth-service
uv run uvicorn app.main:app --reload --port 8002
# docs: http://localhost:8002/docs
```

Seeded coordinators (password `coord123`):

| coordinator_id | college        |
| -------------- | -------------- |
| `coord_rgpv`   | RGPV Bhopal    |
| `coord_davv`   | IET DAVV Indore|
| `coord_manit`  | MANIT Bhopal   |

Key endpoints: `GET /auth/colleges`, `GET /auth/seeded-coordinators`,
`POST /auth/teacher/register`, `POST /auth/teacher/login`,
`POST /auth/coordinator/login`, `GET /auth/me`,
`GET /auth/coordinator/requests?status=pending`,
`POST /auth/coordinator/requests/{id}/decision` (`approved` | `rejected`).

Teacher login returns `403 pending_approval` while waiting and `403 banned`
after a decline. The desktop app also keeps a device-local banned list in
`localStorage` (`mponline_banned`) and the session in `mponline_session`.
