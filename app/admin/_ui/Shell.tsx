"use client";

import ApprovalPopup from "./ApprovalPopup";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdmin } from "./Store";
import { Btn, Field, Icon, Modal, Switch, cx, inputCls, type IconName } from "./kit";

type Nav = { href: string; label: string; icon: IconName; roles: ("admin" | "staff")[]; requiresKot?: boolean; hideWhen?: (s: { walkInsOnly: boolean; kotEnabled: boolean; orderingEnabled: boolean }) => boolean };

/* Pages the sidebar may show. Staff sees only the four the client agreed on
   (billing, orders, open tabs, inventory) plus the kitchen queue when it's on. */
const NAV: Nav[] = [
  { href: "/admin/billing", label: "Billing", icon: "billing", roles: ["admin", "staff"] },
  { href: "/admin/orders", label: "Orders", icon: "orders", roles: ["admin", "staff"] },
  { href: "/admin/analytics", label: "Analytics", icon: "chart", roles: ["admin"] },
  { href: "/admin", label: "KOT", icon: "kitchen", roles: ["admin", "staff"], hideWhen: (s) => s.walkInsOnly || !s.orderingEnabled },
  { href: "/admin/inventory", label: "Inventory", icon: "box", roles: ["admin", "staff"] },
  { href: "/admin/inventory/ingredients", label: "Ingredients & waste", icon: "orders", roles: ["admin", "staff"] },
  { href: "/admin/inventory/ingredient-moves", label: "Ingredient log", icon: "list", roles: ["admin", "staff"] },
  { href: "/admin/inventory/movements", label: "Stock movement", icon: "list", roles: ["admin"] },
  { href: "/admin/expenses", label: "Expenses", icon: "bag", roles: ["admin"] },
  { href: "/admin/activity", label: "Activity log", icon: "list", roles: ["admin"] },
  { href: "/admin/coupons", label: "Coupons", icon: "coupon", roles: ["admin"] },
  { href: "/admin/loyalty", label: "Loyalty", icon: "star", roles: ["admin", "staff"] },
];

/* The shop logo. The built-in 8:2 mark is shown in beige straight on the dark sidebar; a logo uploaded in Settings
   keeps a light tile behind it so it can be seen. */
const Cherry = ({ logo }: { logo?: string }) =>
  !logo || logo === "/logo.png" ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo.png" alt="" className="adm-logo-plain" />
  ) : (
    <span className="adm-logo">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt="" />
    </span>
  );

function Settings({ onClose }: { onClose: () => void }) {
  const { s, act, toast } = useAdmin();
  const [walkInsOnly, setWalkInsOnly] = useState(s.settings.walkInsOnly);
  const [kotEnabled, setKotEnabled] = useState(s.settings.kotEnabled);
  const [orderingEnabled, setOrderingEnabled] = useState(s.settings.orderingEnabled);

  const toggleOrdering = async (v: boolean) => {
    setOrderingEnabled(v);
    const r = await act("settings.update", { orderingEnabled: v });
    if (!r.ok) setOrderingEnabled(!v);
    else toast({ kind: "ok", title: v ? "Customer ordering is on — guests can order from their phone." : "Customer site is now menu-only." });
  };

  const toggleWalkIns = async (v: boolean) => {
    setWalkInsOnly(v);
    const r = await act("settings.update", { walkInsOnly: v });
    if (!r.ok) setWalkInsOnly(!v);
    else toast({ kind: "ok", title: v ? "POS switched to counter walk-ins only." : "Customer tabs are back on." });
  };

  const toggleKot = async (v: boolean) => {
    setKotEnabled(v);
    const r = await act("settings.update", { kotEnabled: v });
    if (!r.ok) setKotEnabled(!v);
    else toast({ kind: "ok", title: v ? "Kitchen queue (KOT) is on." : "Kitchen queue (KOT) is off." });
  };

  const d = s.settings;
  const [form, setForm] = useState({
    shopName: d.shopName, ownerName: d.ownerName, location: d.location, address: d.address, address2: "",
    whatsapp1: d.whatsapp1, whatsapp2: "", customerCare: d.customerCare, email: d.email, mapsUrl: d.mapsUrl, logoUrl: d.logoUrl,
    upiId: d.upiId, upiName: d.upiName, upiPhone: d.upiPhone, upiQrMinutes: String(d.upiQrMinutes),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  /* Shrink a picked PNG/JPG to at most 160px in the browser and keep it as a small
     data URL, so the logo needs no file storage and stays well under the size limit. */
  const pickLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) return toast({ kind: "err", title: "Choose a PNG or JPG image." });
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 160 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      setForm((cur) => ({ ...cur, logoUrl: c.toDataURL(f.type === "image/png" ? "image/png" : "image/jpeg", 0.85) }));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast({ kind: "err", title: "Couldn't read that image." });
    };
    img.src = url;
  };
  const saveDetails = async () => {
    setSaving(true);
    const r = await act("settings.update", form);
    setSaving(false);
    if (r.ok) toast({ kind: "ok", title: "Shop details saved." });
  };

  return (
    <Modal open onClose={onClose} title="Settings">
      <div className="space-y-4">
        <div className="space-y-3 border-b border-slate-100 pb-4">
          <b className="block text-[13.5px] text-slate-900">Shop details</b>
          <p className="text-[12.5px] text-slate-500">Shown on the menu page, receipts and invoices.</p>
          <Field label="Shop name"><input className={inputCls} value={form.shopName} maxLength={60} onChange={set("shopName")} /></Field>
          <Field label="Owner's name"><input className={inputCls} value={form.ownerName} maxLength={80} onChange={set("ownerName")} /></Field>
          <Field label="Location"><input className={inputCls} value={form.location} maxLength={120} onChange={set("location")} /></Field>
          <Field label="Address" hint="One line per row"><textarea className={cx(inputCls, "h-24 py-2")} value={form.address} onChange={set("address")} /></Field>
          <Field label="WhatsApp number"><input className={inputCls} inputMode="tel" value={form.whatsapp1} maxLength={30} onChange={set("whatsapp1")} placeholder="10-digit number" /></Field>
          <Field label="Customer service number"><input className={inputCls} inputMode="tel" value={form.customerCare} maxLength={30} onChange={set("customerCare")} /></Field>
          <Field label="Email"><input className={inputCls} type="email" value={form.email} maxLength={120} onChange={set("email")} /></Field>
          <Field label="Google Maps link"><input className={inputCls} value={form.mapsUrl} maxLength={500} onChange={set("mapsUrl")} placeholder="https://maps.app.goo.gl/…" /></Field>
          <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <b className="block text-[13px] text-slate-900">Guests paying by UPI</b>
            <p className="text-[12px] text-slate-500">Guests see a UPI QR (with their exact amount) on their phone tab. It is your own UPI ID, so there are no fees — but the app can&apos;t see the payment, so staff check their UPI app and confirm. Leave the UPI ID blank to switch it off.</p>
            <Field label="Shop UPI ID" hint="Like name@bank"><input className={inputCls} value={form.upiId} maxLength={80} onChange={set("upiId")} placeholder="yourshop@okicici" autoCapitalize="none" /></Field>
            <Field label="Name shown in the UPI app" hint="Blank uses the shop name"><input className={inputCls} value={form.upiName} maxLength={60} onChange={set("upiName")} /></Field>
            <Field label="GPay / PhonePe number (optional)" hint="Shown next to the UPI ID so customers can also pay by typing this number in GPay. 10 digits."><input className={inputCls} inputMode="numeric" value={form.upiPhone} maxLength={14} onChange={set("upiPhone")} placeholder="98765 43210" /></Field>
            <Field label="Change the QR every (minutes)" hint="A fresh QR replaces the old one on the guest's screen"><input className={inputCls} type="number" min={1} max={30} inputMode="numeric" value={form.upiQrMinutes} onChange={set("upiQrMinutes")} /></Field>
          </div>
          <Field label="Logo" hint="Upload a PNG or JPG, or paste an image link. Blank uses the built-in icon.">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                {form.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.logoUrl} alt="Logo preview" className="h-12 w-auto max-w-[110px] rounded-lg border border-slate-200 bg-white object-contain p-1" />
                )}
                <label className="inline-flex h-10 cursor-pointer items-center rounded-xl border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                  Upload PNG / JPG
                  <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={pickLogo} />
                </label>
                {form.logoUrl && <Btn kind="plain" onClick={() => setForm({ ...form, logoUrl: "" })}>Remove</Btn>}
              </div>
              <input className={inputCls} value={form.logoUrl.startsWith("data:") ? "" : form.logoUrl} maxLength={500} onChange={set("logoUrl")} placeholder={form.logoUrl.startsWith("data:") ? "Uploaded image in use" : "…or paste a link: https://…"} />
            </div>
          </Field>
          <Btn kind="red" onClick={saveDetails} disabled={saving}>{saving ? "Saving…" : "Save shop details"}</Btn>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <b className="block text-[13.5px] text-slate-900">Customer ordering</b>
            <p className="mt-0.5 text-[12.5px] text-slate-500">On: guests can scan, order and open a tab from their phone. Off: the site shows the menu card only — no cart, no tabs, no kitchen tickets.</p>
          </div>
          <Switch on={orderingEnabled} onChange={toggleOrdering} label="Customer ordering" />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <b className="block text-[13.5px] text-slate-900">Walk-ins only</b>
            <p className="mt-0.5 text-[12.5px] text-slate-500">Hide the customer-tab flow in POS Billing. Every bill is a counter walk-in.</p>
          </div>
          <Switch on={walkInsOnly} onChange={toggleWalkIns} label="Walk-ins only" />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <b className="block text-[13.5px] text-slate-900">Kitchen queue (KOT)</b>
            <p className="mt-0.5 text-[12.5px] text-slate-500">On-screen kitchen tickets for the chef. Turn off if the kitchen doesn&apos;t need a queue.</p>
          </div>
          <Switch on={kotEnabled} onChange={toggleKot} label="Kitchen queue" />
        </div>
      </div>
    </Modal>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { s, role, floor, toasts, dismiss, pending, answer, printNode, sound, setSound } = useAdmin();
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false);
  const [rail, setRail] = useState(false); // desktop sidebar collapsed to icons
  useEffect(() => {
    try {
      // read after load so the server and browser render the same HTML
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRail(localStorage.getItem("adm-rail") === "1");
    } catch {}
  }, []);
  const toggleRail = () =>
    setRail((c) => {
      const next = !c;
      try {
        localStorage.setItem("adm-rail", next ? "1" : "0");
      } catch {}
      return next;
    });
  const [lastPath, setLastPath] = useState(path);
  if (path !== lastPath) {
    setLastPath(path);
    setMenu(false);
  }

  const fresh = s.orders.filter((o) => o.source === "customer" && o.status === "new").length;
  const kitchenPending = s.settings.kotEnabled ? s.orders.filter((o) => o.status === "new" || o.status === "preparing").length : 0;
  const billReq = floor.filter((f) => f.billRequested).length;
  const busy = floor.length;
  const low = s.products.filter((p) => p.active && p.stock !== null && p.stock <= p.lowAt).length;

  const badge: Record<string, React.ReactNode> = {
    "/admin": fresh ? (
      <span className="adm-pulse grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{fresh}</span>
    ) : busy ? (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{busy}</span>
    ) : null,
    "/admin/kitchen": kitchenPending ? (
      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{kitchenPending}</span>
    ) : null,
    "/admin/billing": billReq ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{billReq}</span> : null,
    "/admin/inventory": low ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-100 px-1.5 text-[10px] font-bold text-amber-700">{low}</span> : null,
  };

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = fresh ? `(${fresh}) ${base}` : base;
  }, [fresh, path]);

  const signOut = async () => {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.replace("/admin/login");
  };

  /* the longest matching entry wins, so /admin/inventory/movements doesn't also light up Inventory */
  const nav = NAV.filter((n) => n.roles.includes(role) && !(n.requiresKot && !s.settings.kotEnabled) && !(n.hideWhen && n.hideWhen(s.settings)));
  const active = (href: string) =>
    href === "/admin" ? path === "/admin" : path.startsWith(href) && !nav.some((n) => n.href.length > href.length && n.href.startsWith(href) && path.startsWith(n.href));

  const renderSide = (mini: boolean) => (
    <div className="flex h-full flex-col">
      <Link href={role === "admin" ? "/admin" : "/admin/billing"} title={`${s.settings.shopName} · Admin`} className={cx("adm-side__brand flex items-center gap-3 pb-6 pt-6", mini ? "justify-center px-0" : "px-5")}>
        <Cherry logo={s.settings.logoUrl} />
        {!mini && (
          <span className="leading-tight">
            <b className="adm-wordmark block text-[17px]">
              {s.settings.shopName}
            </b>
            <small className="text-[10px] font-bold uppercase tracking-[0.18em]">{role === "admin" ? "Admin console" : "Staff console"}</small>
          </span>
        )}
      </Link>
      <nav className="adm-side__scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-3" aria-label="Admin">
        {nav.map((n) => {
          const on = active(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              title={mini ? n.label : undefined}
              className={cx("adm-link relative flex h-11 items-center rounded-xl text-[14px] font-semibold", on && "is-on", mini ? "justify-center px-0" : "gap-3 px-3")}
            >
              <Icon name={n.icon} size={19} />
              {!mini && <span className="flex-1">{n.label}</span>}
              {!mini && badge[n.href]}
              {mini && badge[n.href] && <span className="adm-pulse absolute right-2 top-2 h-2 w-2 rounded-full bg-red-600 text-red-600" />}
            </Link>
          );
        })}
      </nav>
      <div className="adm-side space-y-1 px-3 py-4" style={{ borderTop: "1px solid var(--line-dark)" }}>
        <button type="button" onClick={() => setSound(!sound)} title={mini ? (sound ? "Order chime on" : "Order chime off") : undefined} className={cx("adm-link flex h-10 w-full items-center rounded-xl text-[13px] font-semibold", mini ? "justify-center px-0" : "gap-3 px-3")}>
          <Icon name={sound ? "bell" : "belloff"} size={17} />
          {!mini && (sound ? "Order chime on" : "Order chime off")}
        </button>
        <a href="/" target="_blank" rel="noopener noreferrer" title={mini ? "Guest website" : undefined} className={cx("adm-link flex h-10 items-center rounded-xl text-[13px] font-semibold", mini ? "justify-center px-0" : "gap-3 px-3")}>
          <Icon name="globe" size={17} />
          {!mini && "Guest website"}
        </a>
        {role === "admin" && (
          <button type="button" onClick={() => setSettings(true)} title={mini ? "Settings" : undefined} className={cx("adm-link flex h-10 w-full items-center rounded-xl text-[13px] font-semibold", mini ? "justify-center px-0" : "gap-3 px-3")}>
            <Icon name="sliders" size={17} />
            {!mini && "Settings"}
          </button>
        )}
        <button type="button" onClick={signOut} title={mini ? "Sign out" : undefined} className={cx("adm-link flex h-10 w-full items-center rounded-xl text-[13px] font-semibold", mini ? "justify-center px-0" : "gap-3 px-3")}>
          <Icon name="logout" size={17} />
          {!mini && "Sign out"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      <div className="adm-app">
        {/* sidebar — desktop */}
        <aside className={cx("adm-side fixed inset-y-0 left-0 z-40 hidden transition-[width] duration-200 lg:block", rail ? "w-[76px]" : "w-[248px]")}>
          {renderSide(rail)}
          <button
            type="button"
            onClick={toggleRail}
            aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
            title={rail ? "Expand sidebar" : "Collapse sidebar"}
            className="absolute -right-3 top-[72px] z-50 hidden h-7 w-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition hover:text-slate-900 lg:grid"
          >
            <Icon name="chevron" size={15} className={cx("transition-transform", rail ? "" : "rotate-180")} />
          </button>
        </aside>

        {/* top bar — mobile */}
        <header className="adm-side sticky top-0 z-40 flex h-14 items-center gap-3 px-4 lg:hidden">
          <button type="button" onClick={() => setMenu(true)} className="adm-link grid h-10 w-10 place-items-center rounded-xl" aria-label="Open menu">
            <Icon name="menu" size={20} />
          </button>
          <b className="adm-wordmark min-w-0 flex-1 truncate text-[16px]">
            {s.settings.shopName} · {role === "admin" ? "Admin" : "Staff"}
          </b>
          {fresh > 0 && (
            <Link href="/admin" className="shrink-0 rounded-full bg-red-600 px-3 py-1 text-[12px] font-bold text-white">
              {fresh} new
            </Link>
          )}
        </header>
        {menu && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button type="button" className="adm-scrim absolute inset-0 bg-slate-900/40" onClick={() => setMenu(false)} aria-label="Close menu" />
            <aside className="adm-side adm-in absolute inset-y-0 left-0 w-[270px] shadow-2xl">{renderSide(false)}</aside>
          </div>
        )}

        {/* main grows to fill whatever the page doesn't use, so the footer sits on
            the bottom edge of a short page instead of floating under the card */}
        <div className={cx("flex flex-1 flex-col min-w-0 transition-[padding] duration-200", rail ? "lg:pl-[76px]" : "lg:pl-[248px]")}>
          <main className="mx-auto w-full min-w-0 max-w-[1480px] flex-1 p-3 sm:p-6">{children}</main>
          <footer className="mx-auto flex w-full max-w-[1480px] flex-col items-center gap-3 border-t border-slate-200 px-4 py-7 text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-500 sm:flex-row sm:justify-between sm:px-6">
            <span>© 2026 All rights reserved. {s.settings.shopName}.</span>
            <span>
              Powered by <span className="text-red-600">Cenexa Systems</span> ©2026
            </span>
            <span className="text-[13px] normal-case tracking-normal text-red-600" style={{ fontFamily: "var(--font-display), Georgia, serif", fontWeight: 600 }}>
              • Fresh, hot & fast.
            </span>
          </footer>
        </div>

        {/* toasts */}
        <div className={cx("pointer-events-none fixed bottom-3 left-3 z-[90] flex w-[min(380px,calc(100%-24px))] flex-col gap-2 sm:bottom-5 sm:left-5", rail ? "lg:left-[96px]" : "lg:left-[268px]")} aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={cx(
                "adm-in pointer-events-auto flex items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_12px_32px_-12px_rgba(15,23,42,.35)]",
                t.kind === "err" ? "border-red-200" : t.kind === "order" ? "border-red-200" : t.kind === "bill" ? "border-amber-200" : "border-slate-200",
              )}
            >
              <span
                className={cx(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
                  t.kind === "err" && "bg-red-50 text-red-600",
                  t.kind === "order" && "bg-red-600 text-white",
                  t.kind === "bill" && "bg-amber-400 text-amber-950",
                  (t.kind === "ok" || t.kind === "info") && "bg-emerald-50 text-emerald-600",
                )}
              >
                <Icon name={t.kind === "err" ? "alert" : t.kind === "order" ? "utensils" : t.kind === "bill" ? "billing" : "check"} size={17} />
              </span>
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  if (t.href) router.push(t.href);
                  dismiss(t.id);
                }}
              >
                <b className="block text-[13.5px] text-slate-900">{t.title}</b>
                {t.body && <span className="mt-0.5 block truncate text-[12.5px] text-slate-500">{t.body}</span>}
              </button>
              <button type="button" onClick={() => dismiss(t.id)} className="text-slate-400 hover:text-slate-700" aria-label="Dismiss">
                <Icon name="x" size={15} />
              </button>
            </div>
          ))}
        </div>

        {/* confirm */}
        <Modal
          open={!!pending}
          onClose={() => answer(false)}
          title={pending?.title ?? ""}
          footer={
            <>
              <Btn onClick={() => answer(false)}>Cancel</Btn>
              <Btn kind={pending?.danger ? "red" : "dark"} onClick={() => answer(true)}>
                {pending?.ok ?? "Confirm"}
              </Btn>
            </>
          }
        >
          <div className="text-[14px] leading-relaxed text-slate-600">{pending?.body}</div>
        </Modal>

        {role === "admin" && <ApprovalPopup />}
        {settings && <Settings onClose={() => setSettings(false)} />}
        <div id="adm-layer" />
      </div>
      <div className="adm-print">{printNode}</div>
    </>
  );
}
