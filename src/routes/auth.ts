import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withAuthContext } from "../db/context.js";
import { verifyPassword } from "../auth/password.js";
import { createJwt, type JwtConfig } from "../auth/jwt.js";

interface LoginBody {
  email: string;
  password: string;
  clinicId: string;
}

export async function authRoutes(
  app: FastifyInstance,
  pool: Pool,
  jwtConfig: JwtConfig
): Promise<void> {
  // Get clinics for a user (before selecting one for login)
  app.post<{ Body: { email: string; password: string } }>(
    "/auth/clinics",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string" },
            password: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const result = await withAuthContext(pool, async (client) => {
        // Find user
        const userResult = await client.query<{
          id: string;
          password_hash: string;
          is_platform_admin: boolean;
        }>(
          "SELECT id, password_hash, is_platform_admin FROM users WHERE email = $1",
          [email.toLowerCase()]
        );

        if (userResult.rows.length === 0) {
          return null;
        }

        const user = userResult.rows[0];
        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
          return null;
        }

        // Get memberships
        const memberships = await client.query<{
          clinic_id: string;
          clinic_name: string;
          role: string;
        }>(
          `SELECT cu.clinic_id, c.name as clinic_name, cu.role
           FROM clinic_users cu
           JOIN clinics c ON c.id = cu.clinic_id
           WHERE cu.user_id = $1`,
          [user.id]
        );

        return {
          userId: user.id,
          isPlatformAdmin: user.is_platform_admin,
          clinics: memberships.rows.map((r) => ({
            clinicId: r.clinic_id,
            clinicName: r.clinic_name,
            role: r.role,
          })),
        };
      });

      if (!result) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      return {
        userId: result.userId,
        isPlatformAdmin: result.isPlatformAdmin,
        clinics: result.clinics,
      };
    }
  );

  // Login with clinic selection
  app.post<{ Body: LoginBody }>(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password", "clinicId"],
          properties: {
            email: { type: "string" },
            password: { type: "string" },
            clinicId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password, clinicId } = request.body;

      const result = await withAuthContext(pool, async (client) => {
        // Find user
        const userResult = await client.query<{
          id: string;
          password_hash: string;
          is_platform_admin: boolean;
        }>(
          "SELECT id, password_hash, is_platform_admin FROM users WHERE email = $1",
          [email.toLowerCase()]
        );

        if (userResult.rows.length === 0) {
          return null;
        }

        const user = userResult.rows[0];
        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
          return null;
        }

        // Verify membership in requested clinic
        const membershipResult = await client.query<{ role: string }>(
          "SELECT role FROM clinic_users WHERE user_id = $1 AND clinic_id = $2",
          [user.id, clinicId]
        );

        if (membershipResult.rows.length === 0) {
          return { error: "not_member" };
        }

        return {
          userId: user.id,
          isPlatformAdmin: user.is_platform_admin,
          role: membershipResult.rows[0].role,
        };
      });

      if (!result) {
        return reply.status(401).send({ error: "Invalid credentials" });
      }

      if ("error" in result) {
        return reply.status(403).send({ error: "Not a member of this clinic" });
      }

      const token = createJwt(
        {
          sub: result.userId,
          clinicId,
          role: result.role,
          isPlatformAdmin: result.isPlatformAdmin,
        },
        jwtConfig
      );

      return { token };
    }
  );
}
