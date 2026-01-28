-- Migration: 001_initial_schema.sql
-- Phase 1: Auth, Tenancy with RLS, Audit, PMS Integration
-- PostgreSQL 17 / Azure Flexible Server
--
-- NOTE: No BEGIN/COMMIT here - migration runner handles transactions
--
-- REQUIRED SESSION VARIABLES (set by application per-request):
--   app.current_user_id    UUID of authenticated user
--   app.current_clinic_id  UUID of selected clinic
--   app.is_platform_admin  'true' if platform admin, else 'false'

-- =========================================================
-- EXTENSIONS
-- =========================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =========================================================
-- SCHEMA MIGRATIONS TRACKING
-- =========================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    checksum    TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- SESSION CONTEXT FUNCTIONS
-- These run as the calling role (clini_app), not SECURITY DEFINER
-- All return NULL/FALSE when context vars are missing or invalid
-- =========================================================

-- Get current clinic ID from session variable
-- Returns NULL if not set, empty, or invalid UUID
CREATE OR REPLACE FUNCTION current_clinic_id()
RETURNS UUID AS $$
DECLARE
    val TEXT;
BEGIN
    val := current_setting('app.current_clinic_id', TRUE);
    IF val IS NULL OR val = '' OR LENGTH(TRIM(val)) = 0 THEN
        RETURN NULL;
    END IF;
    RETURN val::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Get current user ID from session variable
-- Returns NULL if not set, empty, or invalid UUID
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS UUID AS $$
DECLARE
    val TEXT;
BEGIN
    val := current_setting('app.current_user_id', TRUE);
    IF val IS NULL OR val = '' OR LENGTH(TRIM(val)) = 0 THEN
        RETURN NULL;
    END IF;
    RETURN val::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if session is platform admin (VERIFIED against DB)
-- Returns FALSE if:
--   - session var not set to 'true'
--   - user_id not set or invalid
--   - user not found in DB
--   - user.is_platform_admin is false
-- This double-verification prevents forged session vars from granting admin access
CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS BOOLEAN AS $$
DECLARE
    session_flag TEXT;
    uid UUID;
    is_admin BOOLEAN;
BEGIN
    -- Check session flag first (fast path rejection)
    session_flag := current_setting('app.is_platform_admin', TRUE);
    IF session_flag IS NULL OR session_flag <> 'true' THEN
        RETURN FALSE;
    END IF;

    -- Require valid user_id
    uid := current_user_id();
    IF uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- VERIFY against database (prevents forged session vars)
    SELECT u.is_platform_admin INTO is_admin
    FROM users u
    WHERE u.id = uid;

    RETURN COALESCE(is_admin, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if current user has ANY membership in current clinic
-- Returns FALSE if clinic_id or user_id not set/invalid
CREATE OR REPLACE FUNCTION user_has_clinic_access()
RETURNS BOOLEAN AS $$
DECLARE
    cid UUID;
    uid UUID;
BEGIN
    cid := current_clinic_id();
    uid := current_user_id();

    IF cid IS NULL OR uid IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM clinic_users cu
        WHERE cu.clinic_id = cid AND cu.user_id = uid
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if current user is clinic_admin in current clinic
-- Used for mutation policies
CREATE OR REPLACE FUNCTION user_is_clinic_admin()
RETURNS BOOLEAN AS $$
DECLARE
    cid UUID;
    uid UUID;
BEGIN
    cid := current_clinic_id();
    uid := current_user_id();

    IF cid IS NULL OR uid IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM clinic_users cu
        WHERE cu.clinic_id = cid
          AND cu.user_id = uid
          AND cu.role = 'clinic_admin'
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- =========================================================
-- USERS (global, no clinic_id, no RLS)
-- =========================================================
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email               TEXT NOT NULL,
    password_hash       TEXT NOT NULL,
    name                TEXT NOT NULL,
    is_platform_admin   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_email_lowercase CHECK (email = LOWER(email))
);

CREATE INDEX idx_users_email ON users (email);

-- =========================================================
-- CLINICS (tenant root, no clinic_id, no RLS)
-- =========================================================
CREATE TABLE clinics (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                    TEXT NOT NULL,
    timezone                TEXT NOT NULL DEFAULT 'America/Toronto',
    recall_interval_days    INTEGER NOT NULL DEFAULT 180,
    sms_daily_cap           INTEGER NOT NULL DEFAULT 20,
    sms_monthly_cap         INTEGER NOT NULL DEFAULT 500,
    ai_enabled              BOOLEAN NOT NULL DEFAULT TRUE,
    sms_paused              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT clinics_name_not_empty CHECK (LENGTH(TRIM(name)) > 0),
    CONSTRAINT clinics_recall_positive CHECK (recall_interval_days > 0),
    CONSTRAINT clinics_sms_caps_valid CHECK (sms_daily_cap >= 0 AND sms_monthly_cap >= 0)
);

-- =========================================================
-- CLINIC_USERS (tenant-scoped, RLS enabled)
-- =========================================================
CREATE TABLE clinic_users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT clinic_users_unique UNIQUE (clinic_id, user_id),
    CONSTRAINT clinic_users_role_valid CHECK (role IN ('clinic_admin', 'clinic_staff'))
);

CREATE INDEX idx_clinic_users_clinic ON clinic_users (clinic_id);
CREATE INDEX idx_clinic_users_user ON clinic_users (user_id);
CREATE INDEX idx_clinic_users_lookup ON clinic_users (clinic_id, user_id);

-- =========================================================
-- PMS_INTEGRATIONS (tenant-scoped, RLS enabled)
-- =========================================================
CREATE TABLE pms_integrations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id               UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    pms_type                TEXT NOT NULL,
    credentials_ciphertext  BYTEA,
    credentials_iv          BYTEA,
    credentials_key_version INTEGER NOT NULL DEFAULT 1,
    config                  JSONB NOT NULL DEFAULT '{}',
    sync_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    last_sync_at            TIMESTAMPTZ,
    last_sync_error         TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pms_integrations_clinic_unique UNIQUE (clinic_id),
    CONSTRAINT pms_integrations_type_valid CHECK (pms_type IN ('dentrix'))
);

CREATE INDEX idx_pms_integrations_clinic ON pms_integrations (clinic_id);

-- =========================================================
-- AUDIT_LOG (tenant-scoped, RLS enabled, append-only)
-- =========================================================
CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id       UUID REFERENCES clinics(id) ON DELETE SET NULL,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       UUID,
    payload         JSONB NOT NULL DEFAULT '{}',
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_log_clinic ON audit_log (clinic_id) WHERE clinic_id IS NOT NULL;
CREATE INDEX idx_audit_log_user ON audit_log (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX idx_audit_log_action ON audit_log (action);

-- =========================================================
-- AUDIT_LOG: APPEND-ONLY ENFORCEMENT (DB-level)
-- =========================================================
CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- =========================================================
-- ROW LEVEL SECURITY POLICIES
--
-- FAIL-CLOSED DESIGN:
-- - If context vars are NULL/invalid, helper functions return FALSE/NULL
-- - All policies require POSITIVE permission check
-- - No access without valid authenticated context
-- =========================================================

-- ---------------------------------------------------------
-- clinic_users RLS
-- ---------------------------------------------------------
ALTER TABLE clinic_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_users FORCE ROW LEVEL SECURITY;

-- SELECT: see own memberships OR all memberships in current clinic
CREATE POLICY clinic_users_select ON clinic_users
    FOR SELECT
    USING (
        is_platform_admin()
        OR user_id = current_user_id()
        OR (clinic_id = current_clinic_id() AND user_has_clinic_access())
    );

-- INSERT: platform admin OR clinic_admin in target clinic
CREATE POLICY clinic_users_insert ON clinic_users
    FOR INSERT
    WITH CHECK (
        is_platform_admin()
        OR (clinic_id = current_clinic_id() AND user_is_clinic_admin())
    );

-- UPDATE: platform admin OR clinic_admin in target clinic
CREATE POLICY clinic_users_update ON clinic_users
    FOR UPDATE
    USING (
        is_platform_admin()
        OR (clinic_id = current_clinic_id() AND user_is_clinic_admin())
    )
    WITH CHECK (
        clinic_id = current_clinic_id()
    );

-- DELETE: platform admin OR clinic_admin (cannot delete self)
CREATE POLICY clinic_users_delete ON clinic_users
    FOR DELETE
    USING (
        is_platform_admin()
        OR (
            clinic_id = current_clinic_id()
            AND user_is_clinic_admin()
            AND user_id <> current_user_id()
        )
    );

-- ---------------------------------------------------------
-- pms_integrations RLS
-- ---------------------------------------------------------
ALTER TABLE pms_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pms_integrations FORCE ROW LEVEL SECURITY;

CREATE POLICY pms_integrations_select ON pms_integrations
    FOR SELECT
    USING (
        is_platform_admin()
        OR (clinic_id = current_clinic_id() AND user_has_clinic_access())
    );

CREATE POLICY pms_integrations_insert ON pms_integrations
    FOR INSERT
    WITH CHECK (
        is_platform_admin()
        OR (clinic_id = current_clinic_id() AND user_is_clinic_admin())
    );

CREATE POLICY pms_integrations_update ON pms_integrations
    FOR UPDATE
    USING (
        is_platform_admin()
        OR (clinic_id = current_clinic_id() AND user_is_clinic_admin())
    )
    WITH CHECK (
        clinic_id = current_clinic_id()
    );

CREATE POLICY pms_integrations_delete ON pms_integrations
    FOR DELETE
    USING (is_platform_admin());

-- ---------------------------------------------------------
-- audit_log RLS
-- ---------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

-- SELECT: platform admin sees all, others see own clinic only
CREATE POLICY audit_log_select ON audit_log
    FOR SELECT
    USING (
        is_platform_admin()
        OR (clinic_id = current_clinic_id() AND user_has_clinic_access())
    );

-- INSERT: STRICT RULES
-- - clinic_id = NULL: ONLY platform admin can write platform-level logs
-- - clinic_id = current_clinic_id() AND user verified: allowed for authenticated tenant users
-- - clinic_id = other clinic: BLOCKED
-- - No context or unverified membership: BLOCKED
-- This is FAIL-CLOSED: missing context or invalid membership = denied
CREATE POLICY audit_log_insert ON audit_log
    FOR INSERT
    WITH CHECK (
        (clinic_id IS NULL AND is_platform_admin())
        OR (clinic_id = current_clinic_id() AND user_has_clinic_access())
    );

-- UPDATE/DELETE: always blocked (append-only)
CREATE POLICY audit_log_no_update ON audit_log
    FOR UPDATE USING (FALSE);

CREATE POLICY audit_log_no_delete ON audit_log
    FOR DELETE USING (FALSE);

-- =========================================================
-- EXPLICIT GRANTS FOR clini_app (LEAST PRIVILEGE)
-- Default privileges only grant SELECT; explicit grants for mutations
-- =========================================================

-- users: SELECT + INSERT only
-- NO UPDATE: prevents app bugs from modifying is_platform_admin
GRANT SELECT, INSERT ON users TO clini_app;

-- clinics: SELECT + INSERT only
-- NO UPDATE: clinic settings changes require admin role
GRANT SELECT, INSERT ON clinics TO clini_app;

-- clinic_users: SELECT + INSERT + UPDATE + DELETE (RLS protected)
GRANT SELECT, INSERT, UPDATE, DELETE ON clinic_users TO clini_app;

-- pms_integrations: SELECT + INSERT + UPDATE + DELETE (RLS protected)
GRANT SELECT, INSERT, UPDATE, DELETE ON pms_integrations TO clini_app;

-- audit_log: SELECT + INSERT only (append-only by design)
GRANT SELECT, INSERT ON audit_log TO clini_app;

-- schema_migrations: SELECT only (INSERT via clini_admin)
GRANT SELECT ON schema_migrations TO clini_app;

-- Functions: EXECUTE (explicit, though default privileges also grant this)
GRANT EXECUTE ON FUNCTION current_clinic_id() TO clini_app;
GRANT EXECUTE ON FUNCTION current_user_id() TO clini_app;
GRANT EXECUTE ON FUNCTION is_platform_admin() TO clini_app;
GRANT EXECUTE ON FUNCTION user_has_clinic_access() TO clini_app;
GRANT EXECUTE ON FUNCTION user_is_clinic_admin() TO clini_app;

-- =========================================================
-- GRANTS FOR clini_admin (MIGRATIONS ONLY)
-- =========================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO clini_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO clini_admin;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO clini_admin;

-- =========================================================
-- UPDATED_AT TRIGGER
-- =========================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER clinics_updated_at
    BEFORE UPDATE ON clinics FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER clinic_users_updated_at
    BEFORE UPDATE ON clinic_users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER pms_integrations_updated_at
    BEFORE UPDATE ON pms_integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
