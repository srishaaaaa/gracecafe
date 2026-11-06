"use client";

import { useRef, useState } from "react";
import type { Coupon, CouponAudience } from "@/lib/types";
import { couponStatus, rupee } from "@/lib/money";
import { couponPdf, sharePdf } from "@/lib/couponPdf";
import { useAdmin } from "./Store";
import { waLink } from "./receipt";
import { OfferSend } from "./loyalty/OfferSend";
import { Badge, Btn, Empty, Icon, Kpi, Modal, Page, PageHead, SearchBox, Switch, WaIcon, cx, downloadExcel, labelCls } from "./kit";

type Form = { id?: string; code: string; percent: string; minOrder: string; expiresAt: string; limit: string; active: boolean; restricted: boolean; audience: CouponAudience };
const EMPTY: Form = { code: "", percent: "", minOrder: "", expiresAt: "", limit: "", active: true, restricted: false, audience: "all" };

const AUDIENCES: { key: CouponAudience; label: string; hint: string; tone: "slate" | "amber" | "green" }[] = [
  { key: "all", label: "Everyone", hint: "Any customer, member or not", tone: "slate" },
  { key: "regular", label: "Non-loyalty", hint: "Customers who are not loyalty members", tone: "amber" },
  { key: "loyalty", label: "Loyalty members", hint: "Active loyalty members only", tone: "green" },
];

const field = "h-12 w-full rounded-xl bg-slate-50 px-4 text-[14px] font-medium text-slate-900 outline-none ring-slate-100 transition placeholder:text-slate-400 focus:bg-white focus:ring-4";
const STATUS = {
  active: ["Active", "green"],
  expired: ["Expired", "red"],
  exhausted: ["Used up", "red"],
  paused: ["Paused", "slate"],
} as const;

function gen() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = new Uint32Array(7);
  crypto.getRandomValues(r);
  return Array.from(r, (n) => A[n % A.length]).join("");
}

const ddmmyyyy = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return `${day}/${m}/${y}`;
};

const tenDigits = (v: string) => v.replace(/\D/g, "").slice(-10);

/* The form sits on the left and is always open; the list sits on the right. Editing a
   coupon loads it into the same form. Each coupon can be sent to a customer on WhatsApp. */
export default function CouponsPage() {
  const { s, act, confirm, toast, refresh } = useAdmin();
  const [f, setF] = useState<Form>(EMPTY);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<CouponAudience | "every">("every");
  const [busy, setBusy] = useState(false);
  const [sendId, setSendId] = useState<string | null>(null);
  const [blastId, setBlastId] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await act<Coupon>("coupon.save", { ...f, limit: f.limit || null, minOrder: f.minOrder || 0 });
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: f.id ? `${r.result.code} updated` : `${r.result.code} created — it's ready in Billing.` });
      setF(EMPTY);
    }
  };

  const edit = (c: Coupon) => {
    setF({ id: c.id, code: c.code, percent: String(c.percent), minOrder: c.minOrder ? String(c.minOrder) : "", expiresAt: c.expiresAt ?? "", limit: c.limit === null ? "" : String(c.limit), active: c.active, restricted: c.restricted, audience: c.audience });
    // on a phone the form is above the list, so bring it into view
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const remove = async (c: Coupon) => {
    if (await confirm({ title: `Delete ${c.code}?`, body: "Past bills keep the coupon code on record.", ok: "Delete", danger: true })) {
      const r = await act("coupon.delete", { id: c.id });
      if (r.ok && f.id === c.id) setF(EMPTY);
    }
  };

  const list = s.coupons.filter((c) => (tab === "every" || c.audience === tab) && (!q || c.code.toLowerCase().includes(q.toLowerCase())));
  const activeCount = s.coupons.filter((c) => couponStatus(c) === "active").length;
  const redemptions = s.coupons.reduce((n, c) => n + c.used, 0);
  const blasting = blastId ? s.coupons.find((c) => c.id === blastId) ?? null : null;
  const sending = sendId ? s.coupons.find((c) => c.id === sendId) ?? null : null;

  return (
    <Page>
      <PageHead
        title="Coupon Management"
        sub="Create discount codes and send them to customers on WhatsApp. Applies to the product subtotal only."
        right={
          <span className="flex flex-wrap gap-2">
            <Btn
              icon="download"
              className="h-10"
              disabled={!s.coupons.length}
              onClick={() =>
                downloadExcel(`coupons-${new Date().toISOString().slice(0, 10)}.xlsx`, [
                  {
                    name: "Coupons",
                    rows: [
                      ["Code", "Who can use it", "Discount %", "Min order", "Expires", "Usage limit", "Used", "Sent", "Only for customers sent to", "Status"],
                      ...s.coupons.map((c) => [c.code, c.audience === "loyalty" ? "Loyalty members" : c.audience === "regular" ? "Non-loyalty customers" : "Everyone", c.percent, c.minOrder, c.expiresAt ?? "", c.limit ?? "Unlimited", c.used, c.sent, c.restricted ? "Yes" : "No", couponStatus(c)]),
                    ],
                  },
                ])
              }
            >
              Download Excel
            </Btn>
            <Btn icon="refresh" onClick={() => refresh()} className="h-10">
              Refresh
            </Btn>
          </span>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Kpi label="Total coupons" value={s.coupons.length} hint="Configured promotional codes" icon="coupon" tone="amber" />
        <Kpi label="Active coupons" value={activeCount} hint="Live & ready at checkout" icon="check" tone="emerald" />
        <Kpi label="Total redemptions" value={redemptions} hint="Times customers used a coupon" icon="percent" tone="slate" />
      </div>

      <p className="mb-6 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-[13px] font-semibold text-sky-700">
        Coupon discount applies to the product subtotal only — not extra charges or GST. Guests can enter a code from their phone; staff can apply one in Billing.
      </p>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* ---------- new / edit ---------- */}
        <section className="scroll-mt-4 rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(15,23,42,.1)] sm:p-8">
          <div className="mb-6 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-[18px] font-bold text-slate-900">
              {f.id ? (
                <>
                  <Icon name="edit" size={17} /> Edit {f.code || "coupon"}
                </>
              ) : (
                <>
                  <Icon name="plus" size={18} /> New Coupon
                </>
              )}
            </h2>
            {f.id && (
              <button type="button" onClick={() => setF(EMPTY)} className="text-[12.5px] font-bold text-slate-500 hover:text-slate-900">
                Cancel edit
              </button>
            )}
          </div>

          <form ref={formRef} onSubmit={save} className="space-y-5">
            <label className="block">
              <span className={labelCls}>Coupon code *</span>
              <span className="relative block">
                <input
                  className={cx(field, "pr-28 uppercase")}
                  placeholder="E.G. SUMMER20"
                  value={f.code}
                  maxLength={24}
                  onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                  required
                />
                <button type="button" onClick={() => setF({ ...f, code: gen() })} className="absolute right-2 top-1/2 h-8 -translate-y-1/2 rounded-lg bg-red-600 px-4 text-[12.5px] font-bold text-white hover:bg-red-700">
                  Generate
                </button>
              </span>
            </label>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className={labelCls}>Discount % *</span>
                <input className={field} type="number" min={1} max={100} step="0.5" placeholder="e.g. 15" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} required />
              </label>
              <label className="block">
                <span className={labelCls}>Min order (₹)</span>
                <input className={field} type="number" min={0} placeholder="e.g. 1000" value={f.minOrder} onChange={(e) => setF({ ...f, minOrder: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>Expiry date</span>
                <input className={field} type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
              </label>
              <label className="block">
                <span className={labelCls}>Usage limit</span>
                <input className={field} type="number" min={1} placeholder="e.g. 50" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} />
              </label>
            </div>
            <div>
              <span className={labelCls}>Who can use it *</span>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Coupon audience">
                {AUDIENCES.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    role="radio"
                    aria-checked={f.audience === a.key}
                    onClick={() => setF({ ...f, audience: a.key })}
                    className={cx("rounded-xl border px-3 py-2.5 text-left transition", f.audience === a.key ? "border-red-600 bg-red-50 ring-2 ring-red-100" : "border-slate-200 bg-white hover:bg-slate-50")}
                  >
                    <span className="block text-[13px] font-bold text-slate-900">{a.label}</span>
                    <span className="block text-[11px] leading-snug text-slate-500">{a.hint}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
              <span>
                <span className="block text-[13px] font-bold text-slate-800">Only for customers it&apos;s sent to</span>
                <span className="block text-[11.5px] text-slate-500">Works only for the mobile numbers you send it to from this page.</span>
              </span>
              <Switch on={f.restricted} onChange={(v) => setF({ ...f, restricted: v })} label="Only for customers it's sent to" />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="h-12 w-full rounded-xl bg-red-600 text-[14px] font-extrabold uppercase tracking-wide text-white shadow-[0_8px_20px_-10px_rgba(107, 117, 80,.9)] transition hover:bg-red-700 active:scale-[.99] disabled:opacity-50"
            >
              {busy ? "Saving…" : f.id ? "Save changes" : "Create coupon"}
            </button>
          </form>
        </section>

        {/* ---------- list ---------- */}
        <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(15,23,42,.1)] sm:p-8">
          <h2 className="mb-4 flex items-center gap-2 text-[18px] font-bold text-slate-900">
            All Coupons <span className="grid h-6 min-w-6 place-items-center rounded-full bg-slate-900 px-1.5 text-[12px] text-white">{s.coupons.length}</span>
          </h2>
          <div className="mb-4 flex flex-wrap gap-2">
            {([{ key: "every", label: "All" }, ...AUDIENCES] as { key: CouponAudience | "every"; label: string }[]).map((x) => {
              const n = x.key === "every" ? s.coupons.length : s.coupons.filter((c) => c.audience === x.key).length;
              return (
                <button key={x.key} type="button" onClick={() => setTab(x.key)} className={cx("h-8 rounded-full px-3.5 text-[12px] font-bold transition", tab === x.key ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}>
                  {x.label} <span className="opacity-60">{n}</span>
                </button>
              );
            })}
          </div>
          <SearchBox value={q} onChange={setQ} placeholder="Search coupons by code…" className="mb-5 h-11 w-full rounded-xl" />
          {!list.length ? (
            <Empty icon="coupon" title={s.coupons.length ? "No coupons match" : "No coupons yet"}>
              {s.coupons.length ? null : "Create one — guests and staff can use it straight away."}
            </Empty>
          ) : (
            <ul className="adm-scroll -mr-2 max-h-[560px] space-y-4 overflow-y-auto pr-2">
              {list.map((c) => {
                const st = couponStatus(c);
                return (
                  <li key={c.id} className={cx("rounded-2xl border bg-white p-4 shadow-[0_1px_4px_rgba(15,23,42,.05)] transition", f.id === c.id ? "border-slate-400" : st === "active" ? "border-emerald-100" : "border-slate-100")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <b className="min-w-0 truncate font-mono text-[16px] tracking-wider text-slate-900">{c.code}</b>
                      <Badge tone={STATUS[st][1]}>{STATUS[st][0]}</Badge>
                      {c.audience !== "all" && <Badge tone={AUDIENCES.find((a) => a.key === c.audience)!.tone}>{c.audience === "loyalty" ? "Loyalty members" : "Non-loyalty"}</Badge>}
                      {c.restricted && <Badge tone="amber">{c.phones.length ? `Only ${c.phones.length} phone${c.phones.length === 1 ? "" : "s"}` : "Sent-to only"}</Badge>}
                    </div>
                    <p className="mt-1.5 text-[15px] font-extrabold text-red-600">
                      {c.percent}% OFF{c.minOrder ? <span className="text-[12.5px] font-semibold text-slate-500"> · min {rupee(c.minOrder)}</span> : null}
                    </p>
                    <p className="mt-1 text-[12px] text-slate-500">
                      Used {c.used} time{c.used === 1 ? "" : "s"}
                      {c.limit !== null && ` of ${c.limit}`} • {c.expiresAt ? `expires ${ddmmyyyy(c.expiresAt)}` : "no expiry"}
                      {c.sent > 0 && ` • sent ${c.sent}×`}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {(
                        <button type="button" title={c.audience === "loyalty" ? "Send to every loyalty member" : c.audience === "regular" ? "Send to every customer who isn't a loyalty member" : "Send to loyalty members and other customers"} onClick={() => setBlastId(c.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#22c55e] bg-white px-3.5 text-[12px] font-extrabold uppercase tracking-wide text-[#16a34a] hover:bg-emerald-50">
                          <WaIcon size={15} /> {c.audience === "loyalty" ? "All members" : c.audience === "regular" ? "All customers" : "Everyone"}
                        </button>
                      )}
                      <button type="button" onClick={() => setSendId(c.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#22c55e] px-3.5 text-[12px] font-extrabold uppercase tracking-wide text-white hover:bg-[#16a34a]">
                        <WaIcon size={15} /> Send
                      </button>
                      <button
                        type="button"
                        onClick={() => act("coupon.save", { ...c, active: !c.active })}
                        title={c.active ? "Tap to pause" : "Tap to resume"}
                        className={cx("h-9 rounded-lg px-3.5 text-[12px] font-extrabold uppercase tracking-wide", c.active ? "bg-slate-900 text-white hover:bg-slate-700" : "border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100")}
                      >
                        {c.active ? "Active" : "Paused"}
                      </button>
                      <button type="button" onClick={() => edit(c)} aria-label={`Edit ${c.code}`} title="Edit" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">
                        <Icon name="edit" size={15} />
                      </button>
                      <button type="button" onClick={() => remove(c)} aria-label={`Delete ${c.code}`} title="Delete" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600">
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {blasting && (
        <OfferSend
          key={blasting.id}
          title={`${blasting.audience === "loyalty" ? "Send to loyalty members" : blasting.audience === "regular" ? "Send to customers" : "Send to everyone"} · ${blasting.code}`}
          who={blasting.audience === "loyalty" ? "this members-only coupon" : blasting.audience === "regular" ? "this coupon for non-members" : "this coupon"}
          scope={blasting.audience === "loyalty" ? "members" : blasting.audience === "regular" ? "nonMembers" : "everyone"}
          template={[
            "Hi {name}! 🎉",
            `${blasting.audience === "loyalty" ? "Exclusive for our loyalty members at {shop}" : "A special offer from {shop}"}: *${blasting.percent}% OFF*${blasting.minOrder ? ` on orders of ${rupee(blasting.minOrder)}+` : ""}${blasting.expiresAt ? `, valid till ${ddmmyyyy(blasting.expiresAt)}` : ""}.`,
            "",
            `Code: *${blasting.code}*`,
            "Show it at billing, or enter it when you order from your phone.",
          ].join("\n")}
          onSent={(m) => act("coupon.send", { id: blasting.id, phone: m.phone, name: m.name, restricted: blasting.restricted, via: "whatsapp" })}
          onClose={() => setBlastId(null)}
        />
      )}
      {sending && <SendCoupon key={sending.id} coupon={sending} onClose={() => setSendId(null)} />}
    </Page>
  );
}

/* Sends one coupon to one customer: as a link in their WhatsApp chat, or as a PDF
   through the phone's share sheet. The send is recorded once WhatsApp / the share
   sheet has been used, and that is when the phone joins the coupon's list — the
   list "only for this customer" checks against. */
function SendCoupon({ coupon: c, onClose }: { coupon: Coupon; onClose: () => void }) {
  const { s, act, toast } = useAdmin();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [only, setOnly] = useState(c.restricted);
  const [busy, setBusy] = useState(false);
  const ok = /^[6-9]\d{9}$/.test(phone);
  const who = name.trim();
  const shop = s.settings.shopName;
  const base = (s.settings.publicUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  const link = `${base}/coupon/${c.code}${who ? `?n=${encodeURIComponent(who)}` : ""}`;
  const rules = [c.minOrder ? `on orders of ${rupee(c.minOrder)}+` : "", c.expiresAt ? `valid till ${ddmmyyyy(c.expiresAt)}` : ""].filter(Boolean).join(", ");
  const message = [
    `Hi${who ? ` ${who}` : ""}! 🎉`,
    `Here's a *${c.percent}% OFF* coupon from *${shop}*${rules ? ` (${rules})` : ""}.`,
    "",
    `Code: *${c.code}*`,
    "Show it at billing, or enter it when you order from your phone.",
  ];

  const record = async (via: "whatsapp" | "pdf") => {
    const r = await act<Coupon>("coupon.send", { id: c.id, phone, name: who, restricted: only, via });
    if (r.ok) {
      toast({ kind: "ok", title: `${c.code} sent to ${who || phone}` });
      onClose();
    }
  };

  const viaWhatsApp = async () => {
    if (!ok || busy) return;
    window.open(waLink(phone, [...message, "", `Download your coupon: ${link}`].join("\n")), "_blank", "noopener,noreferrer");
    setBusy(true);
    await record("whatsapp");
    setBusy(false);
  };

  const viaPdf = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const file = await couponPdf({ code: c.code, percent: c.percent, minOrder: c.minOrder, expiresAt: c.expiresAt, shopName: shop, customerName: who || undefined, lockedTo: only ? who || phone : undefined, link });
      const how = await sharePdf(file, message.join("\n"));
      if (how === "cancelled") return;
      // no share sheet (most desktops): the PDF was downloaded — open the chat so it can be attached
      if (how === "downloaded") window.open(waLink(phone, message.join("\n")), "_blank", "noopener,noreferrer");
      await record("pdf");
    } catch (e) {
      toast({ kind: "err", title: "Couldn't make the PDF", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <>
          Send coupon · <span className="font-mono tracking-wider">{c.code}</span>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[12.5px] leading-relaxed text-slate-500">
          The coupon goes as a download link in the customer&apos;s WhatsApp chat, or as a PDF with &quot;Generate &amp; share PDF&quot;. It is recorded once the chat or share sheet has been used.
        </p>
        <label className="block">
          <span className={labelCls}>
            Customer phone <span className="text-red-600">*</span>
          </span>
          <input className={field} value={phone} onChange={(e) => setPhone(tenDigits(e.target.value))} placeholder="Enter WhatsApp number" inputMode="numeric" autoComplete="tel-national" />
          {phone && !ok && <span className="mt-1 block text-[11.5px] font-semibold text-amber-600">Enter a 10-digit mobile number.</span>}
        </label>
        <label className="block">
          <span className={labelCls}>Customer name</span>
          <input className={field} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
        </label>
        <div className="flex items-center justify-between gap-4">
          <span className={cx(labelCls, "mb-0")}>Only for this customer</span>
          <Switch on={only} onChange={setOnly} label="Only for this customer" />
        </div>
        {only ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] font-semibold text-amber-800">
            This coupon will only work for the phones it was sent to{c.phones.length ? ` (${c.phones.length} so far)` : ""}. Use a dedicated coupon for this.
          </p>
        ) : (
          c.restricted && <p className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-[12.5px] font-semibold text-sky-700">Sending with this off opens {c.code} to every customer again.</p>
        )}
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-3">
          <button type="button" onClick={onClose} className="h-12 rounded-xl border border-slate-200 bg-white text-[14px] font-bold text-slate-800 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" disabled={!ok || busy} onClick={viaWhatsApp} className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-[#22c55e] px-2 text-[13px] font-bold leading-tight text-white hover:bg-[#16a34a] disabled:opacity-45">
            <WaIcon size={16} /> Send link on WhatsApp
          </button>
          <button type="button" disabled={!ok || busy} onClick={viaPdf} className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-[#22c55e] bg-white px-2 text-[13px] font-bold leading-tight text-[#16a34a] hover:bg-emerald-50 disabled:opacity-45">
            <Icon name="download" size={15} /> {busy ? "Working…" : "Generate & share PDF"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
