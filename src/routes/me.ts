import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { withTenantContext } from "../db/context.js";
import type { JwtConfig } from "../auth/jwt.js";
import { createAuthMiddleware } from "../middleware/auth.js";

export async function meRoutes(
  app: FastifyInstance,
  pool: Pool,
  jwtConfig: JwtConfig
): Promise<void> {
  const authMiddleware = createAuthMiddleware(jwtConfig);

  app.get("/me", { preHandler: [authMiddleware] }, async (request, reply) => {
    const { sub: userId, clinicId, role, isPlatformAdmin } = request.user;

    const result = await withTenantContext(
      pool,
      { userId, clinicId, isPlatformAdmin },
      async (client) => {
        // Get user details
        const userResult = await client.query<{
          id: string;
          email: string;
          name: string;
          is_platform_admin: boolean;
        }>(
          "SELECT id, email, name, is_platform_admin FROM users WHERE id = $1",
          [userId]
        );

        if (userResult.rows.length === 0) {
          return null;
        }

        // Get current clinic details
        const clinicResult = await client.query<{
          id: string;
          name: string;
          timezone: string;
        }>("SELECT id, name, timezone FROM clinics WHERE id = $1", [clinicId]);

        const user = userResult.rows[0];
        const clinic = clinicResult.rows[0];

        return {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            isPlatformAdmin: user.is_platform_admin,
          },
          clinic: clinic
            ? {
                id: clinic.id,
                name: clinic.name,
                timezone: clinic.timezone,
              }
            : null,
          role,
        };
      }
    );

    if (!result) {
      return reply.status(404).send({ error: "User not found" });
    }

    return result;
  });
}
