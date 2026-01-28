import type { Pool, PoolClient } from "pg";

export interface TenantContext {
  userId: string;
  clinicId: string;
  isPlatformAdmin: boolean;
}

export interface PlatformAdminContext {
  userId: string;
}

/**
 * Execute callback within a tenant-scoped transaction.
 * Uses SET LOCAL to ensure context cannot leak between requests.
 */
export async function withTenantContext<T>(
  pool: Pool,
  ctx: TenantContext,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // SET LOCAL: scoped to transaction, auto-cleared on COMMIT/ROLLBACK
    await client.query("SELECT set_config('app.current_user_id', $1, TRUE)", [
      ctx.userId,
    ]);
    await client.query("SELECT set_config('app.current_clinic_id', $1, TRUE)", [
      ctx.clinicId,
    ]);
    await client.query("SELECT set_config('app.is_platform_admin', $1, TRUE)", [
      ctx.isPlatformAdmin ? "true" : "false",
    ]);

    const result = await callback(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    try {
      await client.query("RESET ALL");
    } catch {
      // Ignore reset errors
    }
    client.release();
  }
}

/**
 * Execute callback as platform admin (cross-tenant access).
 * User must be verified platform admin in DB.
 */
export async function withPlatformAdminContext<T>(
  pool: Pool,
  ctx: PlatformAdminContext,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query("SELECT set_config('app.current_user_id', $1, TRUE)", [
      ctx.userId,
    ]);
    await client.query("SELECT set_config('app.current_clinic_id', '', TRUE)");
    await client.query(
      "SELECT set_config('app.is_platform_admin', 'true', TRUE)"
    );

    const result = await callback(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    try {
      await client.query("RESET ALL");
    } catch {
      // Ignore reset errors
    }
    client.release();
  }
}

/**
 * Execute callback without tenant context (for auth operations).
 * Only users/clinics tables accessible (no RLS on those).
 */
export async function withAuthContext<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
