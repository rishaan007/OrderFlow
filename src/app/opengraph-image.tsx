import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "OrderFlow — Next-Gen Social Commerce SaaS Order Management";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "space-between",
          backgroundColor: "#064e3b",
          backgroundImage:
            "radial-gradient(circle at 25px 25px, #047857 2%, transparent 0%), radial-gradient(circle at 75px 75px, #065f46 2%, transparent 0%)",
          backgroundSize: "100px 100px",
          padding: "70px 80px",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              backgroundColor: "#10b981",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "32px",
              fontWeight: 800,
              color: "white",
              boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
            }}
          >
            O
          </div>
          <span style={{ fontSize: "36px", fontWeight: 700, letterSpacing: "-0.5px" }}>
            OrderFlow
          </span>
          <span
            style={{
              marginLeft: "12px",
              padding: "6px 14px",
              backgroundColor: "rgba(255, 255, 255, 0.15)",
              borderRadius: "999px",
              fontSize: "16px",
              fontWeight: 600,
              color: "#a7f3d0",
            }}
          >
            B2B SaaS Commerce
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px", maxWidth: "950px" }}>
          <h1
            style={{
              fontSize: "58px",
              fontWeight: 800,
              lineHeight: 1.15,
              margin: 0,
              letterSpacing: "-1.5px",
            }}
          >
            Turn conversations into <span style={{ color: "#34d399" }}>confirmed orders</span>.
          </h1>
          <p
            style={{
              fontSize: "24px",
              color: "#d1fae5",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            Unified Social Inbox • Multi-Variant Inventory • Automated Stock Deductions • Multi-Tenant Isolation
          </p>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            width: "100%",
            borderTop: "1px solid rgba(255, 255, 255, 0.15)",
            paddingTop: "30px",
            fontSize: "18px",
            color: "#a7f3d0",
          }}
        >
          <span>Built for Instagram & WhatsApp Merchants</span>
          <span style={{ fontWeight: 600, color: "white" }}>orderflow.app</span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
