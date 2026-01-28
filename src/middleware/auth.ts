import type {
  FastifyRequest,
  FastifyReply,
  preHandlerHookHandler,
} from "fastify";
import { verifyJwt, type JwtConfig, type JwtPayload } from "../auth/jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

export function createAuthMiddleware(
  jwtConfig: JwtConfig
): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Missing authorization header" });
    }

    const token = authHeader.slice(7);
    const payload = verifyJwt(token, jwtConfig);

    if (!payload) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    request.user = payload;
  };
}

export function requirePlatformAdmin(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user?.isPlatformAdmin) {
      return reply.status(403).send({ error: "Platform admin required" });
    }
  };
}

export function requireClinicAdmin(): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (
      request.user?.role !== "clinic_admin" &&
      !request.user?.isPlatformAdmin
    ) {
      return reply.status(403).send({ error: "Clinic admin required" });
    }
  };
}
