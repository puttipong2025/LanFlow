import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import type { AppRole } from "@/types";

const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = "7d"; // 7 days for PWA offline support

export type AuthTokenPayload = {
  sub: string;        // profile.id
  phone: string;
  name: string;
  role: AppRole;
  locationIds: string[];
};

function getJwtSecret(): Uint8Array {
  const secret = process.env.LANFLOW_JWT_SECRET;
  if (!secret) {
    throw new Error("LANFLOW_JWT_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

// ── Password hashing ──

export async function hashPassword(raw: string): Promise<string> {
  return bcrypt.hash(raw, SALT_ROUNDS);
}

export async function verifyPassword(raw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(raw, hash);
}

// ── JWT ──

export async function signToken(payload: AuthTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .setIssuer("lanflow")
    .sign(getJwtSecret());
}

export async function verifyToken(token: string): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "lanflow",
    });
    return payload as unknown as AuthTokenPayload;
  } catch {
    return null;
  }
}

/** Check if token is expiring within the given seconds */
export async function isTokenExpiringSoon(token: string, withinSeconds = 86400): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), { issuer: "lanflow" });
    const exp = payload.exp ?? 0;
    return exp - Math.floor(Date.now() / 1000) < withinSeconds;
  } catch {
    return true;
  }
}

// ── Request helpers ──

export function getTokenFromRequest(request: Request): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

export async function getAuthPayload(request: Request): Promise<AuthTokenPayload | null> {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

// ── API route helpers ──



type AuthResult =
  | { ok: true; auth: AuthTokenPayload }
  | { ok: false; response: NextResponse };

/**
 * Use in API routes: extracts and verifies JWT from request.
 * Returns auth payload or a ready-to-return 401 response.
 *
 * Usage:
 *   const result = await requireAuth(request);
 *   if (!result.ok) return result.response;
 *   const { auth } = result;
 */
export async function requireAuth(request: Request): Promise<AuthResult> {
  const auth = await getAuthPayload(request);
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ไม่ได้เข้าสู่ระบบ หรือ token หมดอายุ" },
        { status: 401 }
      ),
    };
  }
  return { ok: true, auth };
}

/**
 * Like requireAuth but also checks that the user has the required role.
 */
export async function requireRole(
  request: Request,
  roles: AppRole[]
): Promise<AuthResult> {
  const result = await requireAuth(request);
  if (!result.ok) return result;
  if (!roles.includes(result.auth.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "ไม่มีสิทธิ์เข้าถึง" },
        { status: 403 }
      ),
    };
  }
  return result;
}
