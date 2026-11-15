import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import { businessOnboardingSchema } from "../src/lib/validations";
import { slugify } from "../src/lib/utils";
import { MemberRole } from "@prisma/client";

describe("Phase 1: Business Onboarding & Profile Management", () => {
  let user: { id: string; email: string };
  let businessId: string;

  beforeAll(async () => {
    user = await prisma.user.create({
      data: {
        name: "Onboarding Test User",
        email: `onboard.${Date.now()}@example.com`,
      },
    });
  });

  it("should validate and slugify workspace names", () => {
    const raw = "Bella & Rose Handcrafted Goods!";
    const slug = slugify(raw);
    expect(slug).toBe("bella-rose-handcrafted-goods");

    const validated = businessOnboardingSchema.safeParse({
      name: raw,
      slug,
      currency: "USD",
      timezone: "UTC",
    });

    expect(validated.success).toBe(true);
  });

  it("should create a business, assign OWNER role, and create profile with autoConfirmOrders=false", async () => {
    const bName = "Chic Studio";
    const bSlug = `chic-studio-${Date.now()}`;

    const business = await prisma.business.create({
      data: {
        name: bName,
        slug: bSlug,
        currency: "USD",
        timezone: "America/New_York",
        members: {
          create: {
            userId: user.id,
            role: MemberRole.OWNER,
          },
        },
        profile: {
          create: {
            instagramHandle: "@chicstudio",
            whatsappNumber: "+15551239876",
            orderPrefix: "CHIC-",
            autoConfirmOrders: false, // Per strict master instructions!
          },
        },
      },
      include: {
        members: true,
        profile: true,
      },
    });

    businessId = business.id;

    expect(business.id).toBeDefined();
    expect(business.members.length).toBe(1);
    expect(business.members[0].role).toBe(MemberRole.OWNER);
    expect(business.profile?.instagramHandle).toBe("@chicstudio");
    expect(business.profile?.whatsappNumber).toBe("+15551239876");
    expect(business.profile?.orderPrefix).toBe("CHIC-");
    expect(business.profile?.autoConfirmOrders).toBe(false);
  });

  it("should update business profile and invoice settings through tenantDb", async () => {
    const tenantDb = getTenantDb(businessId);

    await tenantDb.updateProfile({
      name: "Chic Studio International",
      taxId: "TAX-998877",
      bankDetails: "Wise / Wire: CHIC12345",
      orderPrefix: "CSI-",
      whatsappNumber: "+15550001111",
    });

    const updated = await tenantDb.getBusiness();

    expect(updated?.name).toBe("Chic Studio International");
    expect(updated?.profile?.taxId).toBe("TAX-998877");
    expect(updated?.profile?.bankDetails).toBe("Wise / Wire: CHIC12345");
    expect(updated?.profile?.orderPrefix).toBe("CSI-");
    expect(updated?.profile?.whatsappNumber).toBe("+15550001111");
  });

  afterAll(async () => {
    if (businessId) {
      await prisma.business.deleteMany({ where: { id: businessId } });
    }
    if (user?.id) {
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });
});
