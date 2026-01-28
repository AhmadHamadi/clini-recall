import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withPlatformAdminContext } from "../db/context.js";
import { writeAuditLog } from "../db/audit.js";
import { hashPassword } from "../auth/password.js";
import type { JwtConfig } from "../auth/jwt.js";
import {
  createAuthMiddleware,
  requirePlatformAdmin,
} from "../middleware/auth.js";

interface CreateClinicBody {
  name: string;
  timezone?: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
}

interface CreateUserBody {
  email: string;
  password: string;
  name: string;
  clinicId: string;
  role: "clinic_admin" | "clinic_staff";
}

export async function adminRoutes(
  app: FastifyInstance,
  pool: Pool,
  jwtConfig: JwtConfig
): Promise<void> {
  const authMiddleware = createAuthMiddleware(jwtConfig);
  const adminMiddleware = requirePlatformAdmin();

  // Create clinic with initial admin and PMS integration
  app.post<{ Body: CreateClinicBody }>(
    "/admin/clinics",
    {
      preHandler: [authMiddleware, adminMiddleware],
      schema: {
        body: {
          type: "object",
          required: ["name", "adminEmail", "adminPassword", "adminName"],
          properties: {
            name: { type: "string", minLength: 1 },
            timezone: { type: "string" },
            adminEmail: { type: "string", format: "email" },
            adminPassword: { type: "string", minLength: 8 },
            adminName: { type: "string", minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { name, timezone, adminEmail, adminPassword, adminName } =
        request.body;
      const actorId = request.user.sub;
      const ip = request.ip;

      const passwordHash = await hashPassword(adminPassword);

      const result = await withPlatformAdminContext(
        pool,
        { userId: actorId },
        async (client) => {
          // Check if admin email already exists
          const existingUser = await client.query(
            "SELECT id FROM users WHERE email = $1",
            [adminEmail.toLowerCase()]
          );

          let adminUserId: string;

          if (existingUser.rows.length > 0) {
            adminUserId = existingUser.rows[0].id;
          } else {
            // Create admin user
            const userResult = await client.query<{ id: string }>(
              `INSERT INTO users (email, password_hash, name)
               VALUES ($1, $2, $3)
               RETURNING id`,
              [adminEmail.toLowerCase(), passwordHash, adminName]
            );
            adminUserId = userResult.rows[0].id;

            await writeAuditLog(client, {
              clinicId: null,
              userId: actorId,
              action: "user.created",
              entityType: "user",
              entityId: adminUserId,
              payload: { email: adminEmail.toLowerCase(), name: adminName },
              ipAddress: ip,
            });
          }

          // Create clinic
          const clinicResult = await client.query<{ id: string }>(
            `INSERT INTO clinics (name, timezone)
             VALUES ($1, $2)
             RETURNING id`,
            [name, timezone ?? "America/Toronto"]
          );
          const clinicId = clinicResult.rows[0].id;

          await writeAuditLog(client, {
            clinicId: null,
            userId: actorId,
            action: "clinic.created",
            entityType: "clinic",
            entityId: clinicId,
            payload: { name, timezone: timezone ?? "America/Toronto" },
            ipAddress: ip,
          });

          // Create clinic_users membership (RLS allows platform admin)
          // Need to set clinic context for this insert
          await client.query(
            "SELECT set_config('app.current_clinic_id', $1, TRUE)",
            [clinicId]
          );

          const membershipResult = await client.query<{ id: string }>(
            `INSERT INTO clinic_users (clinic_id, user_id, role)
             VALUES ($1, $2, 'clinic_admin')
             RETURNING id`,
            [clinicId, adminUserId]
          );

          await writeAuditLog(client, {
            clinicId: null,
            userId: actorId,
            action: "clinic_membership.created",
            entityType: "clinic_users",
            entityId: membershipResult.rows[0].id,
            payload: {
              clinicId,
              userId: adminUserId,
              role: "clinic_admin",
            },
            ipAddress: ip,
          });

          // Create initial PMS integration (dentrix, empty config)
          const pmsResult = await client.query<{ id: string }>(
            `INSERT INTO pms_integrations (clinic_id, pms_type, config)
             VALUES ($1, 'dentrix', '{}')
             RETURNING id`,
            [clinicId]
          );

          await writeAuditLog(client, {
            clinicId: null,
            userId: actorId,
            action: "pms_integration.created",
            entityType: "pms_integrations",
            entityId: pmsResult.rows[0].id,
            payload: { clinicId, pmsType: "dentrix" },
            ipAddress: ip,
          });

          return {
            clinicId,
            adminUserId,
            membershipId: membershipResult.rows[0].id,
            pmsIntegrationId: pmsResult.rows[0].id,
          };
        }
      );

      return reply.status(201).send(result);
    }
  );

  // Create user with clinic membership
  app.post<{ Body: CreateUserBody }>(
    "/admin/users",
    {
      preHandler: [authMiddleware, adminMiddleware],
      schema: {
        body: {
          type: "object",
          required: ["email", "password", "name", "clinicId", "role"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            name: { type: "string", minLength: 1 },
            clinicId: { type: "string", format: "uuid" },
            role: { type: "string", enum: ["clinic_admin", "clinic_staff"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password, name, clinicId, role } = request.body;
      const actorId = request.user.sub;
      const ip = request.ip;

      const passwordHash = await hashPassword(password);

      const result = await withPlatformAdminContext(
        pool,
        { userId: actorId },
        async (client) => {
          // Verify clinic exists
          const clinicCheck = await client.query(
            "SELECT id FROM clinics WHERE id = $1",
            [clinicId]
          );
          if (clinicCheck.rows.length === 0) {
            return { error: "clinic_not_found" };
          }

          // Check if user already exists
          const existingUser = await client.query(
            "SELECT id FROM users WHERE email = $1",
            [email.toLowerCase()]
          );

          let userId: string;
          let userCreated = false;

          if (existingUser.rows.length > 0) {
            userId = existingUser.rows[0].id;

            // Check if already a member
            const existingMembership = await client.query(
              "SELECT id FROM clinic_users WHERE user_id = $1 AND clinic_id = $2",
              [userId, clinicId]
            );
            if (existingMembership.rows.length > 0) {
              return { error: "already_member" };
            }
          } else {
            // Create user
            const userResult = await client.query<{ id: string }>(
              `INSERT INTO users (email, password_hash, name)
               VALUES ($1, $2, $3)
               RETURNING id`,
              [email.toLowerCase(), passwordHash, name]
            );
            userId = userResult.rows[0].id;
            userCreated = true;

            await writeAuditLog(client, {
              clinicId: null,
              userId: actorId,
              action: "user.created",
              entityType: "user",
              entityId: userId,
              payload: { email: email.toLowerCase(), name },
              ipAddress: ip,
            });
          }

          // Set clinic context for membership insert
          await client.query(
            "SELECT set_config('app.current_clinic_id', $1, TRUE)",
            [clinicId]
          );

          // Create membership
          const membershipResult = await client.query<{ id: string }>(
            `INSERT INTO clinic_users (clinic_id, user_id, role)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [clinicId, userId, role]
          );

          await writeAuditLog(client, {
            clinicId: null,
            userId: actorId,
            action: "clinic_membership.created",
            entityType: "clinic_users",
            entityId: membershipResult.rows[0].id,
            payload: { clinicId, userId, role },
            ipAddress: ip,
          });

          return {
            userId,
            userCreated,
            membershipId: membershipResult.rows[0].id,
          };
        }
      );

      if ("error" in result) {
        if (result.error === "clinic_not_found") {
          return reply.status(404).send({ error: "Clinic not found" });
        }
        if (result.error === "already_member") {
          return reply
            .status(409)
            .send({ error: "User already member of clinic" });
        }
      }

      return reply.status(201).send(result);
    }
  );

  // List all clinics (platform admin)
  app.get(
    "/admin/clinics",
    { preHandler: [authMiddleware, adminMiddleware] },
    async (request, _reply) => {
      const actorId = request.user.sub;

      const result = await withPlatformAdminContext(
        pool,
        { userId: actorId },
        async (client) => {
          const clinics = await client.query<{
            id: string;
            name: string;
            timezone: string;
            created_at: Date;
          }>(
            "SELECT id, name, timezone, created_at FROM clinics ORDER BY created_at DESC"
          );

          return clinics.rows.map((r) => ({
            id: r.id,
            name: r.name,
            timezone: r.timezone,
            createdAt: r.created_at,
          }));
        }
      );

      return result;
    }
  );
}
