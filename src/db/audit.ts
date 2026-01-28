import type { PoolClient } from "pg";

export interface AuditEntry {
  clinicId: string | null;
  userId: string;
  action: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
  ipAddress?: string;
}

export async function writeAuditLog(
  client: PoolClient,
  entry: AuditEntry
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (clinic_id, user_id, action, entity_type, entity_id, payload, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6, $7::inet)`,
    [
      entry.clinicId,
      entry.userId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId ?? null,
      JSON.stringify(entry.payload ?? {}),
      entry.ipAddress ?? null,
    ]
  );
}
