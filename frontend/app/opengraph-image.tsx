import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "niffyInsure — Decentralized insurance on Stellar";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "linear-gradient(135deg, #0b1020 0%, #131a35 55%, #1b2450 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "#4f7cff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "30px",
              fontWeight: 700,
            }}
          >
            n
          </div>
          <div style={{ fontSize: "30px", fontWeight: 600, letterSpacing: "-0.5px" }}>
            niffyInsure
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{ fontSize: "64px", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-1.5px" }}>
            Decentralized insurance on Stellar
          </div>
          <div style={{ fontSize: "28px", color: "#b9c4e6", lineHeight: 1.4 }}>
            Buy coverage, file claims, and let policyholders vote on payouts.
          </div>
        </div>

        <div style={{ display: "flex", gap: "40px", fontSize: "24px", color: "#8fa2d6" }}>
          <span>Buy</span>
          <span>File</span>
          <span>Community votes</span>
          <span>Payout</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
