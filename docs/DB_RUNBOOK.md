# Database Setup Runbook

Complete setup instructions for Clini Recall on Azure Database for PostgreSQL (Flexible Server).

## Prerequisites

- Azure PostgreSQL Flexible Server (PostgreSQL 17)
- SSL enforcement enabled (Azure default)
- Superuser/admin access for initial setup
- psql client installed locally

## Connection String Format

```
psql "host=clini-recall-db.postgres.database.azure.com port=5432 dbname=postgres user=<USER> sslmode=require"
```

---

## Step 1: Bootstrap Roles

Connect as superuser (typically `postgres` or your Azure admin user):

```bash
psql "host=clini-recall-db.postgres.database.azure.com port=5432 dbname=postgres user=postgres sslmode=require"
```

Run the bootstrap script:

```sql
\i scripts/bootstrap.sql
```

Then set passwords for the new roles:

```sql
ALTER ROLE clini_app WITH PASSWORD 'your_secure_app_password_here';
ALTER ROLE clini_admin WITH PASSWORD 'your_secure_admin_password_here';
\q
```

**Security Note:** Store these passwords in a secure secrets manager (Azure Key Vault, etc.)

---

## Step 2: Run Migrations

Set environment variables:

```bash
export DB_HOST=clini-recall-db.postgres.database.azure.com
export DB_PORT=5432
export DB_NAME=postgres
export DB_SSL=true
export DB_ADMIN_USER=clini_admin
export DB_ADMIN_PASSWORD='your_admin_password'
```

Run migrations:

```bash
npm run migrate
```

Expected output:

```
Connected to database as clini_admin
Applying migration 001_initial_schema...
  ✓ Applied 001_initial_schema

Applied 1 migration(s) successfully
```

---

## Step 3: Seed Platform Admin

```bash
export ADMIN_EMAIL=admin@clinirecall.com
export ADMIN_PASSWORD='SecurePassword123!'  # min 12 chars
export ADMIN_NAME="Platform Admin"

npm run seed:admin
```

Expected output:

```
Connected to database as clini_admin
Created platform admin: <uuid>
Email: admin@clinirecall.com
```

---

## Step 4: Verify RLS Isolation

### 4.1 Setup Test Data (as admin)

```bash
psql "host=clini-recall-db.postgres.database.azure.com port=5432 dbname=postgres user=clini_admin sslmode=require" \
  -f scripts/verify-rls.sql -v phase=setup
```

### 4.2 Run Verification (as app role)

```bash
psql "host=clini-recall-db.postgres.database.azure.com port=5432 dbname=postgres user=clini_app sslmode=require" \
  -f scripts/verify-rls.sql -v phase=verify
```

### Expected Results

| Test | Expected |
|------|----------|
| TEST 1: No context | All counts = 0 |
| TEST 2: Functions | All = TRUE |
| TEST 3: Clinic A context | Total = 1, sees only Clinic A |
| TEST 4: Cross-tenant | Clinic B counts = 0 |
| TEST 5: Insert to Clinic B | ERROR: RLS violation |
| TEST 6: Non-admin platform log | ERROR: RLS violation |
| TEST 6b: Audit log for non-member clinic | ERROR: RLS violation |
| TEST 7: Forged admin flag | is_platform_admin() = FALSE |
| TEST 8: Real admin | sees all (count = 2) |
| TEST 9: Admin platform log | Insert succeeds |

---

## Step 5: Configure Application

Create `.env` file for the Node.js application:

```bash
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# Database (connect as clini_app, NOT clini_admin)
DB_HOST=clini-recall-db.postgres.database.azure.com
DB_PORT=5432
DB_NAME=postgres
DB_USER=clini_app
DB_PASSWORD=your_app_password
DB_SSL=true

# SSL Certificate (REQUIRED in production)
# Download Azure CA cert from: https://www.digicert.com/CACerts/DigiCertGlobalRootG2.crt.pem
# Option 1: File path
DB_CA_CERT=/path/to/DigiCertGlobalRootG2.crt.pem
# Option 2: PEM content directly (copy full cert including BEGIN/END lines)
# DB_CA_CERT=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----

# Development only (NEVER in production):
# DB_INSECURE_SSL=true

# JWT
JWT_SECRET=<generate with: openssl rand -base64 64>
JWT_EXPIRES_IN=8h

# Credential Encryption
CREDENTIALS_KEY_V1=<generate with: openssl rand -base64 32>
CREDENTIALS_CURRENT_KEY_VERSION=1
```

---

## Roles Summary

| Role | Purpose | RLS | When Used |
|------|---------|-----|-----------|
| `postgres` | Superuser | N/A | Initial setup only |
| `clini_admin` | Migrations | Bypassed | CLI scripts only |
| `clini_app` | Application | **Enforced** | Node.js runtime |

**CRITICAL:** The application must ONLY connect as `clini_app`. Never use `clini_admin` credentials in the application.

---

## Security Verification Queries

Run these as `clini_app` to verify least privilege:

```sql
-- Should fail: clini_app cannot update users
UPDATE users SET is_platform_admin = TRUE WHERE email = 'test@test.com';
-- ERROR: permission denied

-- Should fail: clini_app cannot insert to schema_migrations
INSERT INTO schema_migrations (version, name, checksum) VALUES (999, 'test', 'abc');
-- ERROR: permission denied

-- Should fail: clini_app cannot delete from audit_log
DELETE FROM audit_log WHERE id = '00000000-0000-0000-0000-000000000000';
-- ERROR: permission denied (trigger blocks it even if grant existed)
```

---

## Troubleshooting

### "permission denied for schema public"

Run as superuser:

```sql
GRANT USAGE ON SCHEMA public TO clini_app;
```

### "role clini_app does not exist"

Run bootstrap.sql first:

```sql
\i scripts/bootstrap.sql
```

### "SSL required"

Ensure connection string includes `sslmode=require`:

```bash
psql "host=... sslmode=require"
```

### Migration checksum mismatch

A migration file was modified after being applied. This is not allowed.
Options:

1. Restore the original migration file
2. Create a new migration with the changes
3. (Development only) Drop and recreate the database

---

## Backup & Recovery

### Backup

Azure handles automated backups. For manual backup:

```bash
pg_dump "host=... user=clini_admin sslmode=require" > backup.sql
```

### Restore

```bash
psql "host=... user=clini_admin sslmode=require" < backup.sql
```

---

## Key Rotation

To rotate credential encryption keys:

1. Generate new key: `openssl rand -base64 32`
2. Add to env: `CREDENTIALS_KEY_V2=<new_key>`
3. Update: `CREDENTIALS_CURRENT_KEY_VERSION=2`
4. Restart application
5. Keys are rotated automatically on next read of each credential
6. After all credentials rotated, remove old key from env
