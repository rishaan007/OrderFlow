import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OrderFlow — Next-Gen Social Commerce SaaS",
    short_name: "OrderFlow",
    description: "Centralize customer conversations, orders, inventory, payments, and deliveries for social commerce merchants.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#059669",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
