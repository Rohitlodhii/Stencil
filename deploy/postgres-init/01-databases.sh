#!/bin/sh
# Creates both app databases on first postgres boot.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'EOSQL'
SELECT 'CREATE DATABASE examdb' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'examdb')\gexec
SELECT 'CREATE DATABASE mponline_auth' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mponline_auth')\gexec
EOSQL
