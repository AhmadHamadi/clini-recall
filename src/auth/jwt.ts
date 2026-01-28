import crypto from "crypto";

export interface JwtPayload {
  sub: string; // user_id (REQUIRED)
  clinicId: string; // (REQUIRED)
  role: string; // (REQUIRED)
  isPlatformAdmin: boolean; // (REQUIRED)
  iat: number; // issued at (REQUIRED)
  exp: number; // expiration (REQUIRED)
}

export interface JwtConfig {
  secret: string;
  expiresInSeconds: number;
}

interface JwtHeader {
  alg: string;
  typ: string;
}

function base64UrlEncode(data: Buffer | string): string {
  const buffer = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(str: string): Buffer {
  // Restore base64 padding
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

function base64UrlDecodeString(str: string): string {
  return base64UrlDecode(str).toString("utf8");
}

/**
 * Create a signed JWT token.
 * Uses HS256 (HMAC-SHA256) algorithm.
 */
export function createJwt(
  payload: Omit<JwtPayload, "iat" | "exp">,
  config: JwtConfig
): string {
  // Validate required fields
  if (!payload.sub || typeof payload.sub !== "string") {
    throw new Error("JWT payload.sub (user_id) is required");
  }
  if (!payload.clinicId || typeof payload.clinicId !== "string") {
    throw new Error("JWT payload.clinicId is required");
  }
  if (!payload.role || typeof payload.role !== "string") {
    throw new Error("JWT payload.role is required");
  }
  if (typeof payload.isPlatformAdmin !== "boolean") {
    throw new Error("JWT payload.isPlatformAdmin is required");
  }

  const header: JwtHeader = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload: JwtPayload = {
    ...payload,
    iat: now,
    exp: now + config.expiresInSeconds,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac("sha256", config.secret)
    .update(data)
    .digest();

  return `${data}.${base64UrlEncode(signature)}`;
}

/**
 * Verify and decode a JWT token.
 * Returns null if:
 * - Token format is invalid
 * - Algorithm is not HS256
 * - Signature is invalid
 * - Token is expired
 * - Required claims are missing
 */
export function verifyJwt(token: string, config: JwtConfig): JwtPayload | null {
  // Must be string
  if (typeof token !== "string" || !token) {
    return null;
  }

  // Split into parts
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Validate parts are non-empty
  if (!headerB64 || !payloadB64 || !signatureB64) {
    return null;
  }

  // Parse and validate header
  let header: JwtHeader;
  try {
    header = JSON.parse(base64UrlDecodeString(headerB64));
  } catch {
    return null;
  }

  // STRICT: Only accept HS256 algorithm (prevent alg confusion attacks)
  if (header.alg !== "HS256") {
    return null;
  }

  // Verify typ if present
  if (header.typ && header.typ !== "JWT") {
    return null;
  }

  // Compute expected signature
  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto
    .createHmac("sha256", config.secret)
    .update(data)
    .digest();

  // Decode actual signature
  let actualSig: Buffer;
  try {
    actualSig = base64UrlDecode(signatureB64);
  } catch {
    return null;
  }

  // Constant-time signature comparison (prevents timing attacks)
  if (expectedSig.length !== actualSig.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(expectedSig, actualSig)) {
    return null;
  }

  // Parse payload
  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64UrlDecodeString(payloadB64));
  } catch {
    return null;
  }

  // Validate required claims
  if (typeof payload.sub !== "string" || !payload.sub) {
    return null;
  }
  if (typeof payload.clinicId !== "string" || !payload.clinicId) {
    return null;
  }
  if (typeof payload.role !== "string" || !payload.role) {
    return null;
  }
  if (typeof payload.isPlatformAdmin !== "boolean") {
    return null;
  }
  if (typeof payload.iat !== "number") {
    return null;
  }
  if (typeof payload.exp !== "number") {
    return null;
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    return null;
  }

  // Check iat is not in the future (with 60s clock skew tolerance)
  if (payload.iat > now + 60) {
    return null;
  }

  return payload;
}
