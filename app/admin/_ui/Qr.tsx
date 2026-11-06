"use client";

import { create, toDataURL } from "qrcode";
import { useMemo } from "react";

/* Synchronous QR → SVG path, so it can go straight into a print sheet. */

export function qrPath(text: string, margin = 2) {
  const { modules } = create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules.get(y, x)) continue;
      // merge horizontal runs into one rect
      let w = 1;
      while (x + w < n && modules.get(y, x + w)) w++;
      d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`;
      x += w - 1;
    }
  }
  return { d, size: n + margin * 2 };
}

export function Qr({ text, className, color = "#0f172a" }: { text: string; className?: string; color?: string }) {
  const q = useMemo(() => qrPath(text), [text]);
  return (
    <svg viewBox={`0 0 ${q.size} ${q.size}`} className={className} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${text}`}>
      <rect width={q.size} height={q.size} fill="#fff" />
      <path d={q.d} fill={color} />
    </svg>
  );
}

export async function downloadQrPng(text: string, filename: string) {
  const url = await toDataURL(text, { errorCorrectionLevel: "M", margin: 2, width: 1024, color: { dark: "#0f172a", light: "#ffffff" } });
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
