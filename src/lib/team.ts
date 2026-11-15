// Team Member Invitations, Permissions & Role-Based Access Control (RBAC)
import crypto from "crypto";
import { prisma } from "./prisma";
import { MemberRole, InvitationStatus } from "@prisma/client";
import { ForbiddenError, NotFoundError, ConflictError } from "./errors";
import { assertCanAddMember } from "./subscriptions";
import { logger } from "./logger";

export const ROLE_HIERARCHY: Record<MemberRole, number> = {
  OWNER: 4,
  ADMIN: 3,
  MANAGER: 2,
  STAFF: 1,
};

export function hasMinimumRole(userRole: MemberRole, requiredRole: MemberRole): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}

export async function logAuditEvent(
  businessId: string,
  userId: string | null,
  action: string,
  entityType: string,
  entityId?: string | null,
  metadata?: any
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        businessId,
        userId: userId || null,
        action,
        entityType,
        entityId: entityId || null,
        metadata: metadata ? metadata : undefined,
      },
    });
    logger.info(`Audit: [${action}] ${entityType} ${entityId || ""}`, {
      businessId,
      userId: userId || undefined,
      action,
    });
  } catch (err) {
    logger.warn(`Failed to write audit log for ${action}`, { businessId }, err);
  }
}

export async function inviteTeamMember(
  businessId: string,
  inviterUserId: string,
  email: string,
  role: MemberRole = MemberRole.STAFF
) {
  // Check inviter permissions (only OWNER or ADMIN can invite)
  const inviterMember = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: inviterUserId } },
  });

  if (!inviterMember || !hasMinimumRole(inviterMember.role, MemberRole.ADMIN)) {
    throw new ForbiddenError("Only workspace Owners and Admins can invite team members");
  }

  // Prevent inviting another OWNER
  if (role === MemberRole.OWNER) {
    throw new ForbiddenError("Cannot invite a member with OWNER role");
  }

  // Check subscription limits
  await assertCanAddMember(businessId);

  const cleanEmail = email.toLowerCase().trim();

  // Check if user is already a member
  const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existingUser) {
    const isMember = await prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId: existingUser.id } },
    });
    if (isMember) {
      throw new ConflictError("User is already a member of this workspace");
    }
  }

  // Check for existing pending invitation
  const existingInvite = await prisma.teamInvitation.findFirst({
    where: {
      businessId,
      email: cleanEmail,
      status: InvitationStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
  });

  if (existingInvite) {
    throw new ConflictError("An active invitation is already pending for this email");
  }

  // Generate secure token
  const token = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7-day expiration

  const invitation = await prisma.teamInvitation.create({
    data: {
      businessId,
      email: cleanEmail,
      role,
      token,
      expiresAt,
      invitedByUserId: inviterUserId,
      status: InvitationStatus.PENDING,
    },
    include: {
      business: { select: { name: true } },
    },
  });

  await logAuditEvent(businessId, inviterUserId, "INVITE_CREATED", "TEAM_INVITATION", invitation.id, {
    inviteeEmail: cleanEmail,
    role,
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    token: invitation.token,
    expiresAt: invitation.expiresAt.toISOString(),
    status: invitation.status,
    businessName: invitation.business.name,
  };
}

export async function getBusinessInvitations(businessId: string) {
  const invitations = await prisma.teamInvitation.findMany({
    where: { businessId },
    include: {
      invitedBy: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return invitations.map((inv) => ({
    id: inv.id,
    email: inv.email,
    role: inv.role,
    token: inv.token,
    status: inv.status,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    invitedBy: inv.invitedBy ? inv.invitedBy.name : "System",
  }));
}

export async function revokeInvitation(businessId: string, invitationId: string, requesterUserId: string) {
  const requester = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: requesterUserId } },
  });

  if (!requester || !hasMinimumRole(requester.role, MemberRole.ADMIN)) {
    throw new ForbiddenError("Only workspace Owners and Admins can revoke invitations");
  }

  const invitation = await prisma.teamInvitation.findFirst({
    where: { id: invitationId, businessId },
  });

  if (!invitation) {
    throw new NotFoundError("Invitation not found");
  }

  await prisma.teamInvitation.update({
    where: { id: invitationId },
    data: { status: InvitationStatus.REVOKED },
  });

  await logAuditEvent(businessId, requesterUserId, "INVITE_REVOKED", "TEAM_INVITATION", invitationId, {
    email: invitation.email,
  });

  return { success: true };
}

export async function acceptInvitation(token: string, userId: string) {
  const invitation = await prisma.teamInvitation.findUnique({
    where: { token },
    include: { business: true },
  });

  if (!invitation) {
    throw new NotFoundError("Invalid invitation link");
  }

  if (invitation.status !== InvitationStatus.PENDING) {
    throw new ConflictError(`This invitation has already been ${invitation.status.toLowerCase()}`);
  }

  if (invitation.expiresAt < new Date()) {
    await prisma.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.EXPIRED },
    });
    throw new ConflictError("This invitation has expired");
  }

  // Create membership in a transaction
  return prisma.$transaction(async (tx) => {
    // Check if already a member
    const existing = await tx.businessMember.findUnique({
      where: {
        businessId_userId: {
          businessId: invitation.businessId,
          userId,
        },
      },
    });

    if (existing) {
      // Just mark invitation accepted
      await tx.teamInvitation.update({
        where: { id: invitation.id },
        data: { status: InvitationStatus.ACCEPTED },
      });
      return { success: true, businessId: invitation.businessId, role: existing.role };
    }

    const member = await tx.businessMember.create({
      data: {
        businessId: invitation.businessId,
        userId,
        role: invitation.role,
      },
    });

    await tx.teamInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.ACCEPTED },
    });

    await tx.auditLog.create({
      data: {
        businessId: invitation.businessId,
        userId,
        action: "INVITE_ACCEPTED",
        entityType: "TEAM_MEMBER",
        entityId: member.id,
        metadata: { role: invitation.role },
      },
    });

    return {
      success: true,
      businessId: invitation.businessId,
      role: member.role,
    };
  });
}

export async function updateMemberRole(
  businessId: string,
  memberId: string,
  newRole: MemberRole,
  requesterUserId: string
) {
  const requester = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: requesterUserId } },
  });

  if (!requester || !hasMinimumRole(requester.role, MemberRole.ADMIN)) {
    throw new ForbiddenError("Only workspace Owners and Admins can manage member roles");
  }

  const targetMember = await prisma.businessMember.findFirst({
    where: { id: memberId, businessId },
    include: { user: true },
  });

  if (!targetMember) {
    throw new NotFoundError("Team member not found");
  }

  if (targetMember.role === MemberRole.OWNER && requester.role !== MemberRole.OWNER) {
    throw new ForbiddenError("Cannot alter the workspace Owner's role");
  }

  if (newRole === MemberRole.OWNER) {
    throw new ForbiddenError("Cannot promote member to OWNER. Ownership must be transferred");
  }

  const updated = await prisma.businessMember.update({
    where: { id: memberId },
    data: { role: newRole },
  });

  await logAuditEvent(businessId, requesterUserId, "MEMBER_ROLE_UPDATED", "TEAM_MEMBER", memberId, {
    oldRole: targetMember.role,
    newRole,
    targetEmail: targetMember.user.email,
  });

  return updated;
}

export async function removeTeamMember(businessId: string, memberId: string, requesterUserId: string) {
  const requester = await prisma.businessMember.findUnique({
    where: { businessId_userId: { businessId, userId: requesterUserId } },
  });

  if (!requester || !hasMinimumRole(requester.role, MemberRole.ADMIN)) {
    throw new ForbiddenError("Only workspace Owners and Admins can remove team members");
  }

  const targetMember = await prisma.businessMember.findFirst({
    where: { id: memberId, businessId },
    include: { user: true },
  });

  if (!targetMember) {
    throw new NotFoundError("Team member not found");
  }

  if (targetMember.role === MemberRole.OWNER) {
    throw new ForbiddenError("The workspace Owner cannot be removed");
  }

  await prisma.businessMember.delete({
    where: { id: memberId },
  });

  await logAuditEvent(businessId, requesterUserId, "MEMBER_REMOVED", "TEAM_MEMBER", memberId, {
    removedEmail: targetMember.user.email,
  });

  return { success: true };
}
