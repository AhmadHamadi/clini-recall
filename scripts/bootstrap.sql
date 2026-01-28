-- bootstrap.sql
-- Run ONCE as superuser/owner before first migration
-- Sets up database roles for the application
--
-- RUNBOOK:
-- 1. Connect as postgres superuser:
--    psql "host=clini-recall-db.postgres.database.azure.com port=5432 dbname=postgres user=postgres sslmode=require"
-- 2. Run this script: \i scripts/bootstrap.sql
-- 3. Set passwords:
--    ALTER ROLE clini_app WITH PASSWORD 'secure_app_password';
--    ALTER ROLE clini_admin WITH PASSWORD 'secure_admin_password';
-- 4. Run migrations: npm run migrate

-- =========================================================
-- APPLICATION ROLE (used by Node.js app at runtime)
-- =========================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clini_app') THEN
        CREATE ROLE clini_app WITH LOGIN;
    END IF;
END
$$;

-- =========================================================
-- ADMIN ROLE (used for migrations and admin scripts ONLY)
-- =========================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'clini_admin') THEN
        CREATE ROLE clini_admin WITH LOGIN;
    END IF;
END
$$;

-- clini_admin bypasses RLS (for migrations and seeding)
-- WARNING: Application must NEVER connect as clini_admin
ALTER ROLE clini_admin SET row_security TO off;

-- =========================================================
-- DATABASE GRANTS
-- =========================================================
GRANT CONNECT ON DATABASE postgres TO clini_app;
GRANT CONNECT ON DATABASE postgres TO clini_admin;

-- =========================================================
-- SCHEMA GRANTS
-- =========================================================
GRANT USAGE ON SCHEMA public TO clini_app;
GRANT ALL ON SCHEMA public TO clini_admin;

-- =========================================================
-- DEFAULT PRIVILEGES (LEAST PRIVILEGE)
-- clini_admin creates objects; clini_app gets minimal access
-- Per-table DELETE granted explicitly in migrations where needed
-- =========================================================

-- Tables: SELECT only by default
-- INSERT/UPDATE/DELETE granted explicitly per-table in migrations
ALTER DEFAULT PRIVILEGES FOR ROLE clini_admin IN SCHEMA public
    GRANT SELECT ON TABLES TO clini_app;

-- Sequences: USAGE + SELECT (for SERIAL/IDENTITY columns)
ALTER DEFAULT PRIVILEGES FOR ROLE clini_admin IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO clini_app;

-- Functions: EXECUTE
ALTER DEFAULT PRIVILEGES FOR ROLE clini_admin IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO clini_app;

-- =========================================================
-- PASSWORDS (set these manually after running this script)
-- =========================================================
-- ALTER ROLE clini_app WITH PASSWORD 'secure_app_password_here';
-- ALTER ROLE clini_admin WITH PASSWORD 'secure_admin_password_here';
