import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hashPassword, verifyPassword, signSessionToken, verifySessionToken } from "../src/lib/auth";
import { registerSchema, loginSchema } from "../src/lib/validations";
import { prisma } from "../src/lib/prisma";

describe("Phase 1: Authentication & Session Verification", () => {
  const testUserEmail = `test.auth.${Date.now()}@example.com`;
  const plainPassword = "TestPassword123";
  let createdUserId: string;

  it("should securely hash and verify passwords", async () => {
    const hash = await hashPassword(plainPassword);
    expect(hash).not.toBe(plainPassword);
    expect(hash.startsWith("$2")).toBe(true);

    const isMatch = await verifyPassword(plainPassword, hash);
    expect(isMatch).toBe(true);

    const isWrongMatch = await verifyPassword("WrongPassword123", hash);
    expect(isWrongMatch).toBe(false);
  });

  it("should validate registration input with Zod schema", () => {
    // Valid input
    const valid = registerSchema.safeParse({
      name: "Alex Merchant",
      email: "alex@example.com",
      password: "SecurePassword1",
    });
    expect(valid.success).toBe(true);

    // Invalid email
    const invalidEmail = registerSchema.safeParse({
      name: "Alex",
      email: "not-an-email",
      password: "SecurePassword1",
    });
    expect(invalidEmail.success).toBe(false);

    // Weak password (no number)
    const weakPassword = registerSchema.safeParse({
      name: "Alex",
      email: "alex@example.com",
      password: "PasswordOnly",
    });
    expect(weakPassword.success).toBe(false);
  });

  it("should sign and verify JWT session tokens", () => {
    const token = signSessionToken({
      userId: "usr_12345",
      email: "test@example.com",
      systemRole: "USER",
      activeBusinessId: "biz_67890",
    });

    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);

    const decoded = verifySessionToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.userId).toBe("usr_12345");
    expect(decoded?.email).toBe("test@example.com");
    expect(decoded?.activeBusinessId).toBe("biz_67890");

    const invalid = verifySessionToken("invalid.token.string");
    expect(invalid).toBeNull();
  });

  it("should register a new user in the database", async () => {
    const passwordHash = await hashPassword(plainPassword);
    const user = await prisma.user.create({
      data: {
        name: "Test Auth User",
        email: testUserEmail,
        passwordHash,
      },
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe(testUserEmail);
    expect(user.passwordHash).toBe(passwordHash);
    createdUserId = user.id;
  });

  it("should reject duplicate email registration in database", async () => {
    await expect(
      prisma.user.create({
        data: {
          name: "Duplicate User",
          email: testUserEmail,
          passwordHash: "hash123",
        },
      })
    ).rejects.toThrow();
  });

  afterAll(async () => {
    if (createdUserId) {
      await prisma.user.deleteMany({ where: { email: testUserEmail } });
    }
  });
});
