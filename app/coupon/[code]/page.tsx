import Link from "next/link";
import type { Metadata } from "next";
import { couponForPage } from "@/lib/ops";
import { couponStatus, rupee } from "@/lib/money";
import { CouponDownload } from "./CouponDownload";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your coupon", robots: { index: false } };

const ddmmyyyy = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${y}`;
};

const DEAD = { expired: "This coupon has expired.", exhausted: "This coupon has been fully used.", paused: "This coupon is paused right now." } as const;

/* The page a customer lands on from the WhatsApp link: the coupon, and a button to save it as a PDF. */
export default async function CouponPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ n?: string }> }) {
  const { code } = await params;
  const name = ((await searchParams).n ?? "").trim().slice(0, 40);
  const found = await couponForPage(code);

  if (!found) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-6 text-center text-zinc-800">
        <h1 className="mb-1 text-base font-semibold text-zinc-900">Coupon not found</h1>
        <p className="mb-5 max-w-sm text-sm text-zinc-500">This coupon doesn&apos;t exist any more.</p>
        <Link href="/" className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800">
          See the menu
        </Link>
      </div>
    );
  }

  const { coupon: c, shopName, logoUrl } = found;
  const st = couponStatus({ ...c, id: "", restricted: c.restricted, audience: c.audience, phones: [], sent: 0, createdAt: 0 });
  const rules = [c.minOrder ? `On orders of ${rupee(c.minOrder)} or more` : "On any order", c.expiresAt ? `Valid till ${ddmmyyyy(c.expiresAt)}` : "No expiry", c.audience === "loyalty" ? "For loyalty members only" : c.audience === "regular" ? "For non-loyalty customers only" : "", c.restricted ? "Only for the mobile number it was sent to" : ""].filter(Boolean);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f3f4e1] px-4 py-10 text-slate-900">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-[#2b3022] text-white shadow-2xl">
        <div className="p-7">
          {logoUrl && <img src={logoUrl} alt="" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", marginBottom: 10, display: "block" }} />}
          <p className="text-[12px] font-extrabold uppercase tracking-[0.2em] text-[#c9d3a0]">{shopName}</p>
          <p className="mt-1 text-[15px] font-semibold text-slate-200">{name ? `A gift for ${name}` : "A gift for you"}</p>
          <p className="mt-3 text-[56px] font-black leading-none">{c.percent}% OFF</p>
          <div className="mt-6 rounded-2xl border-2 border-dashed border-white/40 bg-white/5 py-4 text-center font-mono text-[30px] font-extrabold tracking-[0.12em]">{c.code}</div>
          <ul className="mt-5 space-y-1.5 text-[13.5px] text-slate-300">
            {rules.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </div>
        <div className="bg-[#9a7420] px-7 py-4 text-[13.5px] font-semibold">Show this code at billing, or enter it when you order from your phone.</div>
      </div>

      {st !== "active" && <p className="mt-4 rounded-xl bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-800">{DEAD[st]}</p>}

      <div className="mt-6 flex w-full max-w-md flex-col gap-2 sm:flex-row">
        <CouponDownload data={{ code: c.code, percent: c.percent, minOrder: c.minOrder, expiresAt: c.expiresAt, shopName, customerName: name || undefined, lockedTo: c.restricted ? name || "the number it was sent to" : undefined }} />
        <Link href="/" className="flex h-12 flex-1 items-center justify-center rounded-xl border border-slate-300 bg-white text-[14px] font-bold text-slate-800 hover:bg-slate-50">
          Order now
        </Link>
      </div>
    </div>
  );
}
