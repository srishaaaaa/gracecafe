import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

/* Role-aware sign-in — the owner (admin) and the day staff (staff).
   Passwords come from the environment (Vercel project settings in prod,
   .env.local locally). The session cookie is `role.exp.sig`, where the HMAC is
   keyed by AUTH_SECRET and signs `role.exp`, so it verifies on every serverless
   instance and a staff token can't be edited into an admin one. */

export const COOKIE = "clc_admin";
const TTL = 1000 * 60 * 60 * 24 * 14; // two weeks

export type Role = "admin" | "staff";
export const ROLES: Role[] = ["admin", "staff"];

const need = (name: string, required = true) => {
  const v = process.env[name];
  if (v) return v;
  if (required && process.env.NEXT_PHASE !== "phase-production-build") throw new Error(`${name} must be set. Add it to .env.local (and to Vercel in production).`);
  return "";
};

const ADMIN_PW = need("ADMIN_PASSWORD");
const STAFF_PW = need("STAFF_PASSWORD", false);
const SECRET = need("AUTH_SECRET");

/* Kept for the Users page, which still stores a per-staff password hash. */
export function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

function eq(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordForRole(role: Role): string {
  return role === "staff" ? STAFF_PW : ADMIN_PW;
}

export function checkPassword(pw: string, role: Role = "admin") {
  return eq(pw, passwordForRole(role));
}

const sign = (payload: string) => createHmac("sha256", SECRET).update(payload).digest("base64url");

export function makeToken(role: Role = "admin") {
  const exp = Date.now() + TTL;
  const payload = `${role}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: TTL / 1000 };
}

export function verifyToken(token: string | undefined): Role | null {
  if (!token) return null;
  const parts = token.split(".");
  /* new format: role.exp.sig */
  if (parts.length === 3) {
    const [role, e, sig] = parts;
    if (role !== "admin" && role !== "staff") return null;
    const exp = Number(e);
    if (!exp || exp < Date.now() || !sig) return null;
    return eq(sig, sign(`${role}.${exp}`)) ? (role as Role) : null;
  }
  /* legacy format: exp.sig — treated as an admin session, so pre-upgrade
     cookies keep working until they expire. */
  if (parts.length === 2) {
    const [e, sig] = parts;
    const exp = Number(e);
    if (!exp || exp < Date.now() || !sig) return null;
    return eq(sig, sign(String(exp))) ? "admin" : null;
  }
  return null;
}

/** The role on the current request's cookie, or null when signed out. */
export async function getRole(): Promise<Role | null> {
  const jar = await cookies();
  return verifyToken(jar.get(COOKIE)?.value);
}

/** True when the visitor holds any valid session (admin OR staff). */
export async function isAuthed(): Promise<boolean> {
  return (await getRole()) !== null;
}

/** Kept for callers that only care whether the owner is signed in (admin-only pages). */
export async function isAdmin(): Promise<boolean> {
  return (await getRole()) === "admin";
}

/* Server-side guard for admin-only server components (analytics, coupons, …).
   Imported dynamically so this module stays safe to import from the Edge
   runtime, which can't bundle `next/navigation`. */
export async function requireAdmin(fallback = "/admin"): Promise<void> {
  const role = await getRole();
  if (role === "admin") return;
  const { redirect } = await import("next/navigation");
  if (!role) redirect("/admin/login");
  redirect(fallback);
}
