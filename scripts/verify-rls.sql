-- verify-rls.sql
-- RLS Isolation Verification Script
--
-- This script MUST be run in two phases:
-- 1. Setup phase: Run as clini_admin to create test data
-- 2. Verify phase: Run as clini_app to verify RLS blocks cross-tenant access
--
-- Usage:
--   # Setup (as admin)
--   psql "sslmode=require host=... user=clini_admin dbname=postgres" -f scripts/verify-rls.sql -v phase=setup
--
--   # Verify (as app)
--   psql "sslmode=require host=... user=clini_app dbname=postgres" -f scripts/verify-rls.sql -v phase=verify

-- =========================================================
-- SETUP PHASE (run as clini_admin)
-- =========================================================
\if :{?phase}
\else
  \set phase 'verify'
\endif

\if :phase = 'setup'

  \echo '=== SETUP PHASE (clini_admin) ==='

  -- Clean up any existing test data
  DELETE FROM audit_log WHERE action LIKE 'test.%';
  DELETE FROM pms_integrations WHERE clinic_id IN (
    SELECT id FROM clinics WHERE name LIKE 'Test Clinic %'
  );
  DELETE FROM clinic_users WHERE clinic_id IN (
    SELECT id FROM clinics WHERE name LIKE 'Test Clinic %'
  );
  DELETE FROM clinics WHERE name LIKE 'Test Clinic %';
  DELETE FROM users WHERE email LIKE 'test-%@verify.local';

  -- Create test users
  INSERT INTO users (id, email, password_hash, name, is_platform_admin) VALUES
    ('11111111-1111-1111-1111-111111111111', 'test-admin@verify.local', 'hash', 'Test Admin', TRUE),
    ('22222222-2222-2222-2222-222222222222', 'test-user-a@verify.local', 'hash', 'Test User A', FALSE),
    ('33333333-3333-3333-3333-333333333333', 'test-user-b@verify.local', 'hash', 'Test User B', FALSE);

  -- Create test clinics
  INSERT INTO clinics (id, name, timezone) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Test Clinic A', 'America/Toronto'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Test Clinic B', 'America/Vancouver');

  -- Create memberships
  INSERT INTO clinic_users (clinic_id, user_id, role) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'clinic_admin'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'clinic_admin');

  -- Create PMS integrations
  INSERT INTO pms_integrations (clinic_id, pms_type, config) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'dentrix', '{"secret": "clinic_a_secret"}'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'dentrix', '{"secret": "clinic_b_secret"}');

  -- Create audit logs
  INSERT INTO audit_log (clinic_id, user_id, action, payload) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'test.clinic_a', '{}'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'test.clinic_b', '{}'),
    (NULL, '11111111-1111-1111-1111-111111111111', 'test.platform', '{}');

  \echo 'Setup complete. Test data created.'
  \echo ''
  \echo 'Now run verification phase as clini_app:'
  \echo '  psql "..." -U clini_app -f verify-rls.sql -v phase=verify'

\elif :phase = 'verify'

  \echo '=== VERIFY PHASE (clini_app) ==='
  \echo ''

  -- -------------------------------------------------------
  -- TEST 1: No context = no access to tenant tables
  -- -------------------------------------------------------
  \echo '--- TEST 1: No context (should return 0 rows) ---'

  SELECT 'clinic_users' AS table_name, COUNT(*) AS row_count FROM clinic_users
  UNION ALL
  SELECT 'pms_integrations', COUNT(*) FROM pms_integrations
  UNION ALL
  SELECT 'audit_log (with clinic_id)', COUNT(*) FROM audit_log WHERE clinic_id IS NOT NULL;

  \echo ''

  -- -------------------------------------------------------
  -- TEST 2: Functions return NULL/FALSE without context
  -- -------------------------------------------------------
  \echo '--- TEST 2: Functions without context ---'

  SELECT
    current_clinic_id() IS NULL AS clinic_id_is_null,
    current_user_id() IS NULL AS user_id_is_null,
    is_platform_admin() = FALSE AS is_admin_false,
    user_has_clinic_access() = FALSE AS has_access_false,
    user_is_clinic_admin() = FALSE AS is_clinic_admin_false;

  \echo ''

  -- -------------------------------------------------------
  -- TEST 3: With Clinic A context, can only see Clinic A data
  -- -------------------------------------------------------
  \echo '--- TEST 3: Clinic A context (User A in Clinic A) ---'

  SELECT set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', FALSE);
  SELECT set_config('app.current_clinic_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', FALSE);
  SELECT set_config('app.is_platform_admin', 'false', FALSE);

  \echo 'Context set. Checking access...'

  -- Should see only Clinic A membership
  SELECT 'clinic_users visible' AS test,
    (SELECT COUNT(*) FROM clinic_users) AS total,
    (SELECT COUNT(*) FROM clinic_users WHERE clinic_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS clinic_a;

  -- Should see only Clinic A PMS
  SELECT 'pms_integrations visible' AS test,
    (SELECT COUNT(*) FROM pms_integrations) AS total,
    (SELECT config->>'secret' FROM pms_integrations LIMIT 1) AS secret_value;

  -- Should see only Clinic A audit logs
  SELECT 'audit_log visible' AS test,
    (SELECT COUNT(*) FROM audit_log WHERE clinic_id IS NOT NULL) AS total;

  \echo ''

  -- -------------------------------------------------------
  -- TEST 4: Cannot see Clinic B data from Clinic A context
  -- -------------------------------------------------------
  \echo '--- TEST 4: Cross-tenant isolation (Clinic B invisible) ---'

  SELECT 'clinic_b_pms' AS test,
    (SELECT COUNT(*) FROM pms_integrations
     WHERE clinic_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') AS should_be_zero;

  SELECT 'clinic_b_audit' AS test,
    (SELECT COUNT(*) FROM audit_log
     WHERE clinic_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') AS should_be_zero;

  \echo ''

  -- -------------------------------------------------------
  -- TEST 5: Cannot INSERT to different clinic
  -- -------------------------------------------------------
  \echo '--- TEST 5: Cannot insert to Clinic B (should fail) ---'

  \set ON_ERROR_STOP off
  INSERT INTO clinic_users (clinic_id, user_id, role)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'clinic_staff');
  \set ON_ERROR_STOP on

  \echo '(Expected: RLS policy violation error above)'
  \echo ''

  -- -------------------------------------------------------
  -- TEST 6: Cannot insert audit_log with NULL clinic_id (not admin)
  -- -------------------------------------------------------
  \echo '--- TEST 6: Non-admin cannot insert platform audit log ---'

  \set ON_ERROR_STOP off
  INSERT INTO audit_log (clinic_id, user_id, action)
  VALUES (NULL, '22222222-2222-2222-2222-222222222222', 'test.should_fail');
  \set ON_ERROR_STOP on

  \echo '(Expected: RLS policy violation error above)'
  \echo ''

  -- -------------------------------------------------------
  -- TEST 6b: Cannot insert audit_log for clinic user is not a member of
  -- Even if context is set to that clinic, membership check blocks it
  -- -------------------------------------------------------
  \echo '--- TEST 6b: Cannot insert audit_log for non-member clinic ---'

  -- User A sets context to Clinic B (which they are NOT a member of)
  SELECT set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', FALSE);
  SELECT set_config('app.current_clinic_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', FALSE);
  SELECT set_config('app.is_platform_admin', 'false', FALSE);

  \set ON_ERROR_STOP off
  INSERT INTO audit_log (clinic_id, user_id, action)
  VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'test.should_fail_membership');
  \set ON_ERROR_STOP on

  \echo '(Expected: RLS policy violation error above)'
  \echo ''

  -- Reset to Clinic A context for remaining tests
  SELECT set_config('app.current_clinic_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', FALSE);

  -- -------------------------------------------------------
  -- TEST 7: Forged is_platform_admin flag rejected
  -- -------------------------------------------------------
  \echo '--- TEST 7: Forged admin flag (User A claims admin) ---'

  -- User A is NOT a platform admin in the DB
  SELECT set_config('app.current_user_id', '22222222-2222-2222-2222-222222222222', FALSE);
  SELECT set_config('app.is_platform_admin', 'true', FALSE);  -- Forged!

  SELECT 'forged_admin_check' AS test,
    is_platform_admin() AS should_be_false;

  -- Should still not see all clinics
  SELECT 'still_isolated' AS test,
    (SELECT COUNT(*) FROM pms_integrations) AS should_be_one;

  \echo ''

  -- -------------------------------------------------------
  -- TEST 8: Real platform admin sees all
  -- -------------------------------------------------------
  \echo '--- TEST 8: Real platform admin (test-admin user) ---'

  SELECT set_config('app.current_user_id', '11111111-1111-1111-1111-111111111111', FALSE);
  SELECT set_config('app.current_clinic_id', '', FALSE);
  SELECT set_config('app.is_platform_admin', 'true', FALSE);

  SELECT 'admin_verified' AS test,
    is_platform_admin() AS should_be_true;

  SELECT 'admin_sees_all_pms' AS test,
    (SELECT COUNT(*) FROM pms_integrations) AS should_be_two;

  SELECT 'admin_sees_all_memberships' AS test,
    (SELECT COUNT(*) FROM clinic_users) AS should_be_two;

  \echo ''

  -- -------------------------------------------------------
  -- TEST 9: Platform admin can insert NULL clinic_id audit log
  -- -------------------------------------------------------
  \echo '--- TEST 9: Platform admin can write platform audit log ---'

  INSERT INTO audit_log (clinic_id, user_id, action)
  VALUES (NULL, '11111111-1111-1111-1111-111111111111', 'test.admin_platform_log');

  SELECT 'platform_log_inserted' AS test,
    (SELECT COUNT(*) FROM audit_log WHERE action = 'test.admin_platform_log') AS should_be_one;

  \echo ''
  \echo '=== ALL TESTS COMPLETE ==='

  -- Reset context
  RESET ALL;

\else
  \echo 'Unknown phase. Use: -v phase=setup OR -v phase=verify'
\endif
