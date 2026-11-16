import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/register", "/privacy", "/terms"],
        disallow: [
          "/api/",
          "/dashboard",
          "/dashboard/",
          "/orders",
          "/orders/",
          "/products",
          "/products/",
          "/customers",
          "/customers/",
          "/inbox",
          "/inbox/",
          "/analytics",
          "/analytics/",
          "/settings",
          "/settings/",
          "/onboarding",
          "/onboarding/",
          "/accept-invite",
          "/accept-invite/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
