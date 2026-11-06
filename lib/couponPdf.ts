/* Browser-only: draws a coupon on a canvas and wraps the picture in a one-page PDF.
   No PDF library — a JPEG can go into a PDF as-is (DCTDecode), so the file is just
   a handful of objects around the image bytes. */

export type CouponCardData = {
  code: string;
  percent: number;
  minOrder: number;
  expiresAt: string | null;
  shopName: string;
  customerName?: string;
  /** shown on the card when the coupon is locked to this customer */
  lockedTo?: string;
  link?: string;
};

const W = 1200;
const H = 680;

const ddmmyyyy = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${y}`;
};
const rs = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, start: number, maxW: number) {
  let px = start;
  g.font = font(px);
  while (px > 14 && g.measureText(text).width > maxW) g.font = font((px -= 2));
}

export function drawCoupon(d: CouponCardData): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const sans = (px: number, w = 700) => `${w} ${px}px "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif`;
  const mono = (px: number) => `800 ${px}px ui-monospace, "SF Mono", Consolas, "Courier New", monospace`;

  g.fillStyle = "#f8fafc";
  g.fillRect(0, 0, W, H);

  // ticket
  const x = 40, y = 40, w = W - 80, h = H - 80, stub = 360;
  roundRect(g, x, y, w, h, 36);
  g.fillStyle = "#0f172a";
  g.fill();
  // stub on the right
  g.save();
  roundRect(g, x, y, w, h, 36);
  g.clip();
  g.fillStyle = "#9a7420";
  g.fillRect(x + w - stub, y, stub, h);
  g.restore();
  // perforation notches
  g.fillStyle = "#f8fafc";
  for (const ny of [y, y + h]) {
    g.beginPath();
    g.arc(x + w - stub, ny, 26, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = "rgba(255,255,255,.55)";
  g.lineWidth = 3;
  g.setLineDash([12, 12]);
  g.beginPath();
  g.moveTo(x + w - stub, y + 40);
  g.lineTo(x + w - stub, y + h - 40);
  g.stroke();
  g.setLineDash([]);

  // left side
  const lx = x + 60;
  const lw = w - stub - 120;
  g.textBaseline = "alphabetic";
  g.fillStyle = "#fca5a5";
  g.font = sans(26, 800);
  fit(g, d.shopName.toUpperCase(), (px) => sans(px, 800), 26, lw);
  g.fillText(d.shopName.toUpperCase(), lx, y + 82);

  g.fillStyle = "#ffffff";
  fit(g, d.customerName ? `A gift for ${d.customerName}` : "A gift for you", (px) => sans(px, 600), 30, lw);
  g.fillText(d.customerName ? `A gift for ${d.customerName}` : "A gift for you", lx, y + 128);

  g.font = sans(150, 900);
  fit(g, `${d.percent}% OFF`, (px) => sans(px, 900), 150, lw);
  g.fillText(`${d.percent}% OFF`, lx, y + 290);

  // code box
  const by = y + 330;
  roundRect(g, lx, by, lw, 104, 18);
  g.fillStyle = "rgba(255,255,255,.06)";
  g.fill();
  g.strokeStyle = "rgba(255,255,255,.45)";
  g.lineWidth = 3;
  g.setLineDash([14, 10]);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = "#ffffff";
  fit(g, d.code, mono, 64, lw - 60);
  g.textAlign = "center";
  g.fillText(d.code, lx + lw / 2, by + 74);
  g.textAlign = "left";

  const rules = [
    d.minOrder ? `On orders of ${rs(d.minOrder)} or more` : "On any order",
    d.expiresAt ? `Valid till ${ddmmyyyy(d.expiresAt)}` : "No expiry",
    d.lockedTo ? `Only for ${d.lockedTo}` : "",
  ].filter(Boolean);
  g.fillStyle = "#cbd5e1";
  g.font = sans(25, 600);
  rules.forEach((r, i) => g.fillText(`•  ${r}`, lx, by + 150 + i * 36));

  // stub
  const sx = x + w - stub / 2;
  g.textAlign = "center";
  g.fillStyle = "#ffffff";
  g.font = sans(26, 800);
  g.fillText("COUPON CODE", sx, y + 130);
  g.font = sans(120, 900);
  g.fillText("%", sx, y + 300);
  g.font = sans(24, 600);
  ["Show this code", "at billing, or enter", "it when you order", "from your phone."].forEach((t, i) => g.fillText(t, sx, y + 400 + i * 34));
  g.font = sans(18, 500);
  g.fillStyle = "rgba(255,255,255,.8)";
  g.fillText("Applies to the item subtotal", sx, y + h - 36);
  g.textAlign = "left";
  return c;
}

const enc = new TextEncoder();

/** A one-page PDF holding a JPEG. Page is the picture's shape, sized in points. */
function jpegToPdf(jpeg: Uint8Array, pw: number, ph: number, iw: number, ih: number): Blob {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === "string" ? enc.encode(b) : b;
    parts.push(u);
    len += u.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  obj(3, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push("\nendstream");
  });
  obj(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export async function couponPdf(d: CouponCardData): Promise<File> {
  const c = drawCoupon(d);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't draw the coupon."))), "image/jpeg", 0.92));
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  const pdf = jpegToPdf(jpeg, Math.round(W * 0.5), Math.round(H * 0.5), W, H);
  return new File([pdf], `coupon-${d.code}.pdf`, { type: "application/pdf" });
}

export function downloadFile(f: File) {
  const url = URL.createObjectURL(f);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Opens the share sheet with the PDF where the browser supports it.
    Returns "shared", "downloaded" (no share sheet — the file was saved instead) or "cancelled". */
export async function sharePdf(f: File, text: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [f] })) {
    try {
      await nav.share({ files: [f], text, title: f.name });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  downloadFile(f);
  return "downloaded";
}
