import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { AuthSession, SessionUser, ActiveBusinessContext } from "@/types";
import { MemberRole } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET || "orderflow-dev-secret-key-change-in-production-2025";
export const SESSION_COOKIE_NAME = "orderflow_session";
export const BUSINESS_COOKIE_NAME = "orderflow_active_business";

export interface JWTPayload {
  userId: string;
  email: string;
  systemRole: string;
  activeBusinessId?: string | null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSessionToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifySessionToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch {
    return null;
  }
}

/**
 * Retrieves the full authenticated session from cookies on the server.
 */
export async function getServerSession(): Promise<AuthSession | null> {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const payload = verifySessionToken(token);
  if (!payload?.userId) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    include: {
      businessMembers: {
        include: {
          business: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const sessionUser: SessionUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    systemRole: user.systemRole,
  };

  const businesses = user.businessMembers.map((bm) => ({
    id: bm.business.id,
    name: bm.business.name,
    slug: bm.business.slug,
    role: bm.role,
  }));

  // Resolve active business:
  // 1. From cookie if present and user is a member
  // 2. From JWT payload if valid member
  // 3. First business in list
  const requestedBusinessId =
    cookieStore.get(BUSINESS_COOKIE_NAME)?.value || payload.activeBusinessId;

  let activeMembership = requestedBusinessId
    ? user.businessMembers.find((bm) => bm.businessId === requestedBusinessId)
    : null;

  if (!activeMembership && user.businessMembers.length > 0) {
    activeMembership = user.businessMembers[0];
  }

  const activeBusiness: ActiveBusinessContext | null = activeMembership
    ? {
        businessId: activeMembership.business.id,
        businessName: activeMembership.business.name,
        businessSlug: activeMembership.business.slug,
        role: activeMembership.role,
        currency: activeMembership.business.currency,
        timezone: activeMembership.business.timezone,
      }
    : null;

  return {
    user: sessionUser,
    activeBusiness,
    businesses,
  };
}
