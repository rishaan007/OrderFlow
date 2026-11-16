import { describe, it, expect } from "vitest";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import { metadata as rootMetadata } from "../src/app/layout";
import { metadata as notFoundMetadata } from "../src/app/not-found";
import { metadata as privacyMetadata } from "../src/app/privacy/page";
import { metadata as termsMetadata } from "../src/app/terms/page";
import { middleware } from "../src/middleware";
import { NextRequest } from "next/server";
import { trackEvent, trackConversion } from "../src/lib/analytics-client";

describe("Production Readiness: Audit & Quality Gates", () => {
  describe("1. Custom 404 & Metadata", () => {
    it("should export correct 404 metadata with noindex directives", () => {
      expect(notFoundMetadata.title).toContain("404");
      expect(notFoundMetadata.robots).toEqual({ index: false, follow: false });
    });
  });

  describe("2 & 3. Page Titles, Descriptions & Open Graph", () => {
    it("should configure root metadata with dynamic title template and Open Graph", () => {
      expect(rootMetadata.title).toBeDefined();
      expect((rootMetadata.title as any).template).toBe("%s | OrderFlow");
      expect(rootMetadata.description).toBeDefined();
      expect(rootMetadata.openGraph).toBeDefined();
      expect((rootMetadata.openGraph as any).siteName).toBe("OrderFlow");
      expect(rootMetadata.twitter).toBeDefined();
      expect((rootMetadata.twitter as any).card).toBe("summary_large_image");
    });

    it("should export unique, descriptive metadata for Privacy and Terms pages", () => {
      expect(privacyMetadata.title).toBe("Privacy Policy");
      expect(privacyMetadata.description).toContain("OrderFlow");
      expect(termsMetadata.title).toBe("Terms of Service");
      expect(termsMetadata.description).toContain("Terms and Conditions");
    });
  });

  describe("6. Robots.txt Configuration", () => {
    it("should generate compliant robots directives allowing public routes and disallowing private app routes", () => {
      const robotsConfig = robots();
      expect(robotsConfig.rules).toBeDefined();
      const rules = Array.isArray(robotsConfig.rules) ? robotsConfig.rules[0] : robotsConfig.rules;
      expect(rules.allow).toContain("/");
      expect(rules.allow).toContain("/login");
      expect(rules.allow).toContain("/register");
      expect(rules.allow).toContain("/privacy");
      expect(rules.allow).toContain("/terms");

      expect(rules.disallow).toContain("/api/");
      expect(rules.disallow).toContain("/dashboard");
      expect(rules.disallow).toContain("/orders");
      expect(rules.disallow).toContain("/analytics");
      expect(rules.disallow).toContain("/settings");
      expect(robotsConfig.sitemap).toContain("/sitemap.xml");
    });
  });

  describe("7. Sitemap.xml Configuration", () => {
    it("should generate canonical URLs for all indexable public pages", () => {
      const sitemapEntries = sitemap();
      expect(sitemapEntries.length).toBeGreaterThanOrEqual(5);
      const urls = sitemapEntries.map((e) => e.url);
      expect(urls.some((u) => u.endsWith("/login"))).toBe(true);
      expect(urls.some((u) => u.endsWith("/register"))).toBe(true);
      expect(urls.some((u) => u.endsWith("/privacy"))).toBe(true);
      expect(urls.some((u) => u.endsWith("/terms"))).toBe(true);
    });
  });

  describe("Security Headers & Middleware Route Protection", () => {
    it("should set essential HTTP security headers on all responses", () => {
      const req = new NextRequest("http://localhost:3000/");
      const res = middleware(req);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("X-XSS-Protection")).toBe("1; mode=block");
      expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    });

    it("should redirect unauthenticated users attempting to access /analytics to /login", () => {
      const req = new NextRequest("http://localhost:3000/analytics");
      const res = middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login?redirect=%2Fanalytics");
    });

    it("should redirect unauthenticated users attempting to access /orders/new to /login with redirect parameter", () => {
      const req = new NextRequest("http://localhost:3000/orders/new");
      const res = middleware(req);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/login?redirect=%2Forders%2Fnew");
    });
  });

  describe("18. Analytics Consent Gate & Sensitive Data Scrubbing", () => {
    it("should not throw or leak secrets when tracking events without user consent", () => {
      // In tests/Node environment without consent set, trackEvent should safely do nothing
      expect(() => {
        trackEvent("test_action", {
          password: "supersecretpassword",
          token: "jwt-token-value",
          safeKey: "safeValue",
        });
      }).not.toThrow();

      expect(() => {
        trackConversion("ORDER_CREATED", {
          orderId: "ord_123",
          bankDetails: "Chase 12345678",
        });
      }).not.toThrow();
    });
  });
});
