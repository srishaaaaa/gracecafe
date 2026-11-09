"use client";

import { subscribeChanges } from "@/lib/realtime";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { MenuItem, OrderStatus, TabClose, TabView } from "@/lib/types";
import { rupee } from "@/lib/money";
import { entries, priceRange } from "@/lib/variants";
import { Arrow, Cherry } from "./bits";
import { UpiPay } from "./UpiPay";

/* ============================================================
   MENU — what a guest sees after scanning the shop's QR.
   Browse → add → send to kitchen → watch status → finish up → pay.
   A guest is known by the mobile they order with. When the counter settles their
   tab, the view reports it back here, so the phone says goodbye and wipes itself
   clean for the next visit.
   ============================================================ */

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;
type Cart = Record<string, number>;

const sized = (src: string, w: number) => (src.includes("images.unsplash.com") ? src.replace(/([?&])w=\d+/, `$1w=${w}`) : src);

const STEPS: OrderStatus[] = ["new", "preparing", "served"];
const STEP_LABEL: Record<OrderStatus, string> = { new: "Received", preparing: "Preparing", served: "Served", cancelled: "Cancelled" };

/* Cart + remembered guest details live in localStorage, read as an external
   store (in-memory copy is the source of truth if storage is blocked). */
const mem = new Map<string, unknown>();
const subs = new Set<() => void>();
const subscribe = (cb: () => void) => (subs.add(cb), () => void subs.delete(cb));
function peek<T>(key: string, fallback: T): T {
  if (!mem.has(key)) {
    let v: unknown = fallback;
    try {
      const raw = localStorage.getItem(key);
      if (raw) v = JSON.parse(raw);
    } catch {}
    mem.set(key, v);
  }
  return mem.get(key) as T;
}
function put(key: string, v: unknown) {
  mem.set(key, v);
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {}
  subs.forEach((f) => f());
}
/* Same store, but memory only — the value dies with the page. Used for the
   receipt on screen, which must not come back on the next visit. */
function putMem(key: string, v: unknown) {
  mem.set(key, v);
  subs.forEach((f) => f());
}
function useStored<T>(key: string, fallback: T) {
  const v = useSyncExternalStore(subscribe, () => peek(key, fallback), () => fallback);
  const set = useCallback((next: T | ((prev: T) => T)) => put(key, typeof next === "function" ? (next as (p: T) => T)(peek(key, fallback)) : next), [key, fallback]);
  return [v, set] as const;
}
const NO_CART: Cart = {};
const NO_GUEST = { name: "", phone: "" };

/* Mobiles are a bare 10-digit number here too, so the counter and the guest
   agree on what was typed. A pasted +91 / leading 0 prefix is dropped. */
const tenDigits = (v: string) => {
  const d = v.replace(/\D/g, "");
  const bare = d.length === 12 && d.startsWith("91") ? d.slice(2) : d.length === 11 && d.startsWith("0") ? d.slice(1) : d;
  return bare.slice(0, 10);
};
const time = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/* ---------------- bottom sheet ---------------- */
function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    panel.current?.focus({ preventScroll: true });
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div className={`tm-sheet ${open ? "is-open" : ""}`} role="dialog" aria-modal="true" aria-label={label} aria-hidden={!open} inert={!open}>
      <button type="button" className="tm-sheet__scrim" aria-label="Close" onClick={onClose} tabIndex={-1} />
      <div className="tm-sheet__panel" ref={panel} tabIndex={-1}>
        <span className="tm-sheet__grip" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

/* ---------------- − qty + ---------------- */
function Stepper({ qty, onChange, max, size = "md", name }: { qty: number; onChange: (n: number) => void; max: number; size?: "md" | "sm"; name: string }) {
  return (
    <span className={`tm-step tm-step--${size}`}>
      <button type="button" onClick={() => onChange(qty - 1)} aria-label={`One less ${name}`}>
        −
      </button>
      <b key={qty} aria-live="polite">
        {qty}
      </b>
      <button type="button" onClick={() => onChange(qty + 1)} disabled={qty >= max} aria-label={`One more ${name}`}>
        +
      </button>
    </span>
  );
}

/* Pinned under the header for as long as the tab is open, so the state of the
   kitchen is always in view — not only while the "Your tab" sheet is open. */
function LiveStatus({ orders, onOpen }: { orders: NonNullable<TabView["tab"]>["orders"]; onOpen: () => void }) {
  const live = orders.filter((o) => o.status === "new" || o.status === "preparing");
  const served = orders.filter((o) => o.status === "served");
  const lead = live[live.length - 1];
  const at = lead ? STEPS.indexOf(lead.status) : 2;
  let title: string;
  let sub: string;
  if (lead) {
    title = `Order #${lead.no} · ${STEP_LABEL[lead.status]}`;
    sub = live.length > 1 ? `+${live.length - 1} more in the kitchen` : lead.status === "new" ? "Sent to the kitchen" : "Being made fresh for you";
  } else if (served.length) {
    title = "All served — enjoy! ✺";
    sub = "Tap to see your orders";
  } else {
    title = "Your order was cancelled";
    sub = "Please ask our staff";
  }
  return (
    <button type="button" className={`tm-live ${lead ? "" : "is-calm"}`} onClick={onOpen} aria-live="polite">
      <span className="tm-live__t">
        <b>{title}</b>
        <small>{sub}</small>
      </span>
      {lead ? (
        <span className="tm-live__steps" aria-hidden="true">
          {STEPS.map((s, i) => (
            <i key={s} className={i < at ? "is-done" : i === at ? "is-now" : ""} />
          ))}
        </span>
      ) : null}
      <em>Track</em>
    </button>
  );
}

/* Coupon entry for the open tab. The discount is a preview — the counter
   re-checks the code when the bill is made. */
function CouponBox({ tab, phone, onView }: { tab: NonNullable<TabView["tab"]>; phone: string; onView: (v: TabView) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/tab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, phone }) });
      const data = await r.json();
      if (!r.ok) return setMsg(data.error || "Couldn't apply that coupon.");
      onView(data.view);
      setText("");
    } catch {
      setMsg("You seem to be offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const c = tab.coupon;
  if (c)
    return (
      <div className="tm-coupon is-on">
        <div>
          <b>{c.code}</b>
          <small>{c.ok ? `${c.percent}% off — saves ${rupee(c.discount)}` : `Not applying right now: ${c.reason}`}</small>
        </div>
        <button type="button" disabled={busy} onClick={() => send({ action: "coupon.remove" })}>
          Remove
        </button>
      </div>
    );
  return (
    <form
      className="tm-coupon"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) send({ action: "coupon", code: text });
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="Have a coupon code?" maxLength={24} aria-label="Coupon code" />
      <button type="submit" disabled={busy || !text.trim()}>
        {busy ? "…" : "Apply"}
      </button>
      {msg && <p role="alert">{msg}</p>}
    </form>
  );
}

function waHref(n: string) {
  const d = n.replace(/\D/g, "");
  return d ? `https://wa.me/${d.length === 10 ? "91" + d : d}` : "";
}

/** Branch addresses, WhatsApp numbers, customer service, email and map link — all from Settings. */
function ShopContact({ d }: { d: TabView["details"] }) {
  const branches = [
    { n: 1, address: d.address, wa: d.whatsapp1 },
  ].filter((b) => b.address || b.wa);
  if (!branches.length && !d.customerCare && !d.email && !d.mapsUrl) return null;
  return (
    <section className="tm-contact" aria-label="Contact">
      {branches.map((b) => (
        <div key={b.n} className="tm-contact__card">
          <small>{d.location || "Find us"}</small>
          {b.address && <p>{b.address.split("\n").map((l, i) => <span key={i}>{l}</span>)}</p>}
          {b.wa && <a href={waHref(b.wa)} target="_blank" rel="noopener noreferrer">WhatsApp {b.wa}</a>}
        </div>
      ))}
      <div className="tm-contact__card">
        <small>Get in touch</small>
        {d.customerCare && <a href={`tel:${d.customerCare.replace(/[^\d+]/g, "")}`}>Customer service {d.customerCare}</a>}
        {d.email && <a href={`mailto:${d.email}`}>{d.email}</a>}
        <a href="https://instagram.com/grace_cafe_valliyur" target="_blank" rel="noopener noreferrer">Instagram @grace_cafe_valliyur</a>
        {d.mapsUrl && <a href={d.mapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>}
        {d.ownerName && <p>Owner: {d.ownerName}</p>}
      </div>
    </section>
  );
}

export default function Menu({ initial }: { initial: TabView }) {
  const [view, setView] = useState(initial);
  const [cart, setCart] = useStored<Cart>("clc-cart", NO_CART);
  const [saved, setSaved] = useStored("clc-guest", NO_GUEST);
  /* True while this phone has a tab running, so a phone that never ordered
     is never shown someone else's receipt. */
  const [mine, setMine] = useStored("clc-open", false);
  /* The close this phone has already been thanked for (its `closed.at`). The
     receipt is a one-time thing: it shows in full once, then this marker retires
     it, so closing the page and scanning again lands on a clean menu and the next
     order starts a brand-new tab. 0 = nothing owed yet. */
  const [seenClose, setSeenClose] = useStored("clc-seen", 0);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState<null | "cart" | "tab" | "family">(null);
  const [fam, setFam] = useState(""); // the product family whose options are open in the bottom sheet
  const [finish, setFinish] = useState(false);
  const [placed, setPlaced] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const hello = "Welcome";
  // null = not typed yet → fall back to what this phone remembered last time
  const [form, setForm] = useState<{ name: string | null; phone: string | null; note: string }>({
    name: null,
    phone: null,
    note: "",
  });
  const guest = { ...form, name: form.name ?? saved.name, phone: form.phone ?? saved.phone };
  const setGuest = (g: typeof guest) => setForm(g);

  const railRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);

  /* ---------- live refresh (order status, sold-out items) ---------- */
  const phone = saved.phone;
  /* The phone the current `view` was fetched for. The first view is rendered on
     the server without knowing whose phone this is, so until it has been fetched
     for the saved number, an empty `tab` must not be read as "the visit is over". */
  const [syncedFor, setSyncedFor] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/tab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", phone }), cache: "no-store" });
      if (r.ok) {
        setView(await r.json());
        setSyncedFor(phone);
      }
    } catch {}
  }, [phone]);

  /* The server renders the menu alone (it can't know whose phone this is), so a
     returning guest's tab — or their receipt — is fetched the moment the page loads. */
  useEffect(() => {
    if (!phone) return;
    let live = true;
    fetch("/api/tab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", phone }), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (!live || !v) return;
        setView(v);
        setSyncedFor(phone);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [phone]);

  const cooking = !!view.tab?.orders.some((o) => o.status === "new" || o.status === "preparing");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      t = setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        tick();
      }, cooking ? 15000 : 60000);
    };
    tick();
    const onVis = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [cooking, refresh]);

  /* Live signal: refresh when the shop reports a change. A short random delay
     spreads the phones out so a busy moment doesn't hit the server all at once. */
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeChanges(() => {
      clearTimeout(t);
      t = setTimeout(() => document.visibilityState === "visible" && void refresh(), Math.random() * 1500);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, [refresh]);

  /* ---------- this device's tab, and its ending ---------- */
  useEffect(() => {
    if (view.tab && !mine) setMine(true);
  }, [view.tab, mine, setMine]);

  /* The receipt on screen. It lives in the memory-only half of the store, so it
     survives the re-render that retires the visit below but never a reload. */
  const bye = useSyncExternalStore(subscribe, () => peek<TabClose | null>("clc-bye", null), () => null);

  useEffect(() => {
    if (view.tab) return; // the tab is still running — nothing has ended
    if (!mine) return; // this phone was never part of it
    if (syncedFor !== phone) return; // this phone's tab hasn't been fetched yet
    const close = view.closed;
    if (close && close.at === seenClose) return; // already thanked for this one

    /* The counter settled this phone's tab (or it was settled long enough ago
       that the close has aged out of the view). Either way the visit is over, so
       everything this phone was keeping about it goes now — the next scan lands
       on a clean menu and the next order opens a brand-new tab. The receipt is
       shown once, here, and `seenClose` retires it for good. */
    if (close) {
      putMem("clc-bye", close);
      setSeenClose(close.at);
    }
    setMine(false);
    setCart(NO_CART);
    setSaved(NO_GUEST);
  }, [view.tab, view.closed, mine, seenClose, syncedFor, phone, setMine, setSeenClose, setCart, setSaved]);

  /* The phone was already wiped when the receipt went up, so this just drops
     it and returns to a fresh menu without a reload. */
  const leave = () => {
    putMem("clc-bye", null);
    setForm({ name: null, phone: null, note: "" });
    setSheet(null);
    setFinish(false);
    setPlaced(null);
    refresh();
  };

  /* ---------- derived ---------- */
  const byId = useMemo(() => new Map(view.menu.map((m) => [m.id, m])), [view.menu]);
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ item: byId.get(id), id, qty }))
    .filter((l) => l.qty > 0);
  const count = lines.reduce((s, l) => s + (l.item ? l.qty : 0), 0);
  const total = lines.reduce((s, l) => s + (l.item ? l.item.price * l.qty : 0), 0);
  const unavailable = lines.filter((l) => !l.item || l.item.soldOut || (l.item.left !== null && l.qty > l.item.left));

  const needle = q.trim().toLowerCase();
  const cats = useMemo(() => {
    const out: { name: string; items: MenuItem[] }[] = [];
    for (const m of view.menu) {
      if (needle && !`${m.name} ${m.description} ${m.category}`.toLowerCase().includes(needle)) continue;
      const c = out.find((x) => x.name === m.category);
      if (c) c.items.push(m);
      else out.push({ name: m.category, items: [m] });
    }
    return out;
  }, [view.menu, needle]);

  const maxFor = (m: MenuItem) => Math.min(30, m.left ?? 30);

  /* ---------- scroll-spy for the category rail ---------- */
  useEffect(() => {
    const secs = Array.from(document.querySelectorAll<HTMLElement>("[data-cat]"));
    if (!secs.length) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.cat));
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    secs.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [cats.length, needle]);

  useEffect(() => {
    const rail = railRef.current;
    const chip = rail?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (rail && chip) rail.scrollTo({ left: chip.offsetLeft - rail.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
  }, [active]);

  const jump = (i: number) => {
    document.querySelector(`[data-cat="${i}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ---------- cart ops (+ a little arc from the button to the basket) ---------- */
  const fly = (from: HTMLElement) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const a = from.getBoundingClientRect();
    const b = count > 0 && badgeRef.current ? badgeRef.current.getBoundingClientRect() : { left: window.innerWidth / 2 - 90, top: window.innerHeight - 52, width: 28, height: 28 };
    const x0 = a.left + a.width / 2 - 8, y0 = a.top + a.height / 2 - 8;
    const x1 = b.left + b.width / 2 - 8, y1 = b.top + b.height / 2 - 8;
    const outer = document.createElement("span");
    const inner = document.createElement("i");
    outer.className = "tm-fly";
    outer.appendChild(inner);
    document.body.appendChild(outer);
    const dur = 620;
    outer.animate([{ transform: `translateX(${x0}px)` }, { transform: `translateX(${x1}px)` }], { duration: dur, easing: "linear", fill: "forwards" });
    inner
      .animate([{ transform: `translateY(${y0}px) scale(1)` }, { transform: `translateY(${y1}px) scale(.55)` }], { duration: dur, easing: "cubic-bezier(.45,-0.7,.75,1)", fill: "forwards" })
      .finished.then(() => outer.remove(), () => outer.remove());
  };

  const setQty = (id: string, n: number) =>
    setCart((c) => {
      const next = { ...c };
      if (n <= 0) delete next[id];
      else next[id] = n;
      return next;
    });

  const add = (m: MenuItem, e: React.MouseEvent<HTMLElement>) => {
    fly(e.currentTarget);
    setQty(m.id, Math.min(maxFor(m), (cart[m.id] ?? 0) + 1));
  };

  /* ---------- place order ---------- */
  /* The mobile is the key to the tab: asked once, remembered for the visit. */
  const needDetails = !view.tab;

  const place = async () => {
    setErr("");
    if (!count) return;
    if (unavailable.length) return setErr("Some items changed — please adjust the ones marked below.");
    if (!view.tab && !guest.name.trim()) return setErr("Please tell us your name.");
    if (!/^[6-9]\d{9}$/.test(guest.phone)) return setErr("Please enter a valid 10-digit mobile number.");
    setBusy(true);
    try {
      const r = await fetch("/api/tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "order",
          items: lines.map((l) => ({ productId: l.id, qty: l.qty })),
          name: guest.name,
          phone: guest.phone,
          note: guest.note,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setErr(data.error || "Couldn't send your order. Please try again.");
        refresh();
        return;
      }
      put("clc-guest", { name: guest.name, phone: guest.phone });
      setView(data.view);
      setCart(NO_CART);
      setForm((g) => ({ ...g, note: "" }));
      setSheet(null);
      setPlaced(data.no);
    } catch {
      setErr("You seem to be offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const askBill = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/tab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "bill", phone }) });
      const data = await r.json();
      if (r.ok) setView(data.view);
    } finally {
      setBusy(false);
    }
  };

  const closeSheet = useCallback(() => setSheet(null), []);
  const tab = view.tab;
  /* The admin can switch the site to menu-only. The cart, tab, "Add" buttons
     and the bottom bars all drop out — guests just browse the card. */
  const ordering = view.orderingEnabled !== false;
  /* A cart left behind from before ordering was switched off must not pop up a
     bar the guest can't settle, so wipe it the first time we see the mode. */
  useEffect(() => {
    if (!ordering && count > 0) setCart(NO_CART);
  }, [ordering, count, setCart]);
  const liveOrders = tab?.orders.filter((o) => o.status !== "cancelled").length ?? 0;
  /* everything eaten so far, one line per item, for the end-of-meal receipt */
  const billLines = useMemo(() => {
    const m = new Map<string, { name: string; price: number; qty: number }>();
    for (const o of tab?.orders ?? []) {
      if (o.status === "cancelled") continue;
      for (const it of o.items) {
        const k = `${it.name}@${it.price}`;
        const cur = m.get(k) ?? { name: it.name, price: it.price, qty: 0 };
        cur.qty += it.qty;
        m.set(k, cur);
      }
    }
    return [...m.values()];
  }, [tab]);
  const doneBar = !!tab && !count && !finish && !bye;

  return (
    <div className="tm">
      {/* ================= header ================= */}
      <header className="tm-top">
        <span className="tm-brand">
          {view.details.logoUrl && view.details.logoUrl !== "/logo.png" ? <img className="tm-logo" src={view.details.logoUrl} alt="" /> : <Cherry size={26} />}
          <em>{view.shopName}</em>
        </span>
        {tab ? (
          <button type="button" className="tm-tabbtn" onClick={() => setSheet("tab")}>
            <span>Your tab</span>
            <b>{rupee(tab.total)}</b>
          </button>
        ) : null}
      </header>

      {tab && tab.orders.length > 0 && <LiveStatus orders={tab.orders} onOpen={() => setSheet("tab")} />}

      {/* ================= intro ================= */}
      <section className="tm-hero">
        <p className="tm-hero__hi">
          {hello}
          {tab?.name ? `, ${tab.name.split(" ")[0]}` : ""} ✺
        </p>
        <h1 className="tm-hero__t">
          What are we <em>having?</em>
        </h1>
        <p className="tm-hero__sub">
          {ordering
            ? <>Order straight from your phone. We&apos;ll have it ready for you — pay at the counter when you&apos;re done.</>
            : <>Browse what&apos;s on today. Place your order at the counter.</>}
        </p>
        <div className="tm-tools">
          <label className="tm-search">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Search the menu</span>
            <input type="search" placeholder="Burger, momos, mojito…" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
      </section>

      {/* ================= category rail ================= */}
      {!needle && cats.length > 1 && (
        <nav className="tm-rail" ref={railRef} aria-label="Menu sections">
          {cats.map((c, i) => (
            <button type="button" key={c.name} data-chip={i} className={active === i ? "is-on" : ""} onClick={() => jump(i)}>
              {c.name}
              <small>{c.items.length}</small>
            </button>
          ))}
        </nav>
      )}

      {/* ================= menu ================= */}
      <main className="tm-menu">
        {cats.length === 0 && (
          <p className="tm-empty">
            Nothing matches{needle ? <> &ldquo;{q}&rdquo;</> : ""}. <button type="button" onClick={() => setQ("")}>Show everything</button>
          </p>
        )}
        {cats.map((c, ci) => (
          <section key={c.name} className="tm-cat" data-cat={ci} aria-labelledby={`cat-${ci}`}>
            <header className="tm-cat__head">
              <span>({String(ci + 1).padStart(2, "0")})</span>
              <h2 id={`cat-${ci}`}>{c.name}</h2>
            </header>
            <ul>
              {entries(c.items).map((e, i) => {
                if (e.family !== null) {
                  /* a family is one card: "Tea · from ₹20 · 2 options · Choose ›" — tapping it opens a sheet with a row per variant */
                  const vs = e.items;
                  const { min } = priceRange(vs);
                  const inBasket = vs.reduce((n, v) => n + (cart[v.id] ?? 0), 0);
                  const allOut = vs.every((v) => v.soldOut);
                  const pic = vs.find((v) => v.image)?.image ?? "";
                  const lead = vs[0];
                  return (
                    <li key={"fam:" + e.family} className={`tm-item ${allOut ? "is-out" : ""} ${inBasket ? "is-in" : ""}`} style={{ "--i": Math.min(i, 8) } as CSSVars}>
                      <div className="tm-item__img">
                        {pic ? <img src={sized(pic, 280)} alt="" loading={ci < 1 ? "eager" : "lazy"} decoding="async" /> : <span className="tm-item__ph">{e.family.slice(0, 1)}</span>}
                        {allOut && <span className="tm-item__out">Sold out</span>}
                      </div>
                      <div className="tm-item__body">
                        <h3>{e.family}</h3>
                        {lead.tags.includes("bestseller") && <span className="tm-tag">★ Bestseller</span>}
                        {lead.tags.includes("new") && <span className="tm-tag tm-tag--new">New</span>}
                        {lead.description && <p>{lead.description}</p>}
                        <div className="tm-item__foot">
                          <span className="tm-from">
                            from <b className="tm-price">{rupee(min)}</b>
                          </span>
                          <span className="tm-opts">{vs.length} options</span>
                          <span className="tm-item__act">
                            <button type="button" className="tm-add" disabled={allOut} onClick={() => (setFam(e.family), setSheet("family"))} aria-label={`Choose ${e.family}`}>
                              {inBasket ? `${inBasket} added` : "Choose"} <span aria-hidden="true">›</span>
                            </button>
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                }
                const m = e.item;
                const qty = cart[m.id] ?? 0;
                return (
                  <li key={m.id} className={`tm-item ${m.soldOut ? "is-out" : ""} ${qty ? "is-in" : ""}`} style={{ "--i": Math.min(i, 8) } as CSSVars}>
                    <div className="tm-item__img">
                      {m.image ? <img src={sized(m.image, 280)} alt="" loading={ci < 1 ? "eager" : "lazy"} decoding="async" /> : <span className="tm-item__ph">{m.name.slice(0, 1)}</span>}
                      {m.soldOut && <span className="tm-item__out">Sold out</span>}
                    </div>
                    <div className="tm-item__body">
                      <h3>
                        {m.name}
                      </h3>
                      {m.tags.includes("bestseller") && <span className="tm-tag">★ Bestseller</span>}
                      {m.tags.includes("new") && <span className="tm-tag tm-tag--new">New</span>}
                      {m.description && <p>{m.description}</p>}
                      <div className="tm-item__foot">
                        <b className="tm-price">{rupee(m.price)}</b>
                        {m.points > 0 && <span className="tm-pts" title="Loyalty points you earn">+{m.points} pts</span>}
                        {m.left !== null && !m.soldOut && <span className="tm-left">Only {m.left} left</span>}
                        {ordering && (
                          <span className="tm-item__act">
                            {m.soldOut ? null : qty ? (
                              <Stepper qty={qty} max={maxFor(m)} name={m.name} onChange={(n) => setQty(m.id, n)} />
                            ) : (
                              <button type="button" className="tm-add" onClick={(e) => add(m, e)} aria-label={`Add ${m.name}`}>
                                Add <span aria-hidden="true">+</span>
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <footer className="tm-foot">
          <Cherry size={20} />
          <p>
            Allergies or a special request? Add a note with your order — the kitchen reads every one.
          </p>
        </footer>
        <ShopContact d={view.details} />
      </main>

      {/* ================= cart bar ================= */}
      <div className={`tm-cbar ${count && ordering ? "is-on" : ""}`} aria-hidden={!count || !ordering}>
        <button type="button" onClick={() => setSheet("cart")} tabIndex={count && ordering ? 0 : -1}>
          <span className="tm-cbar__n" ref={badgeRef} key={count}>
            {count}
          </span>
          <span className="tm-cbar__t">
            View order
            <small>{count === 1 ? "1 item" : `${count} items`}</small>
          </span>
          <b>{rupee(total)}</b>
          <Arrow size={18} />
        </button>
      </div>

      {/* ================= cart sheet ================= */}
      {/* ================= a family's options ================= */}
      <Sheet open={sheet === "family"} onClose={closeSheet} label={fam || "Options"}>
        <div className="tm-fam">
          <h2>{fam}</h2>
          <p className="tm-fam__sub">Pick what you would like</p>
          <ul>
            {view.menu
              .filter((m) => m.family && m.family.toLowerCase() === fam.toLowerCase())
              .map((m) => {
                const qty = cart[m.id] ?? 0;
                return (
                  <li key={m.id} className={`tm-var ${m.soldOut ? "is-out" : ""} ${qty ? "is-in" : ""}`}>
                    <span className="tm-var__img">{m.image ? <img src={sized(m.image, 120)} alt="" loading="lazy" decoding="async" /> : <span>{(m.variant || m.name).slice(0, 1)}</span>}</span>
                    <div className="tm-var__body">
                      <b>{m.variant || m.name}</b>
                      <span className="tm-var__meta">
                        <b className="tm-price">{rupee(m.price)}</b>
                        {m.points > 0 && <span className="tm-pts">+{m.points} pts</span>}
                        {m.left !== null && !m.soldOut && <span className="tm-left">Only {m.left} left</span>}
                      </span>
                    </div>
                    {ordering &&
                      (m.soldOut ? (
                        <span className="tm-var__out">Sold out</span>
                      ) : qty ? (
                        <Stepper qty={qty} max={maxFor(m)} name={m.name} onChange={(n) => setQty(m.id, n)} />
                      ) : (
                        <button type="button" className="tm-add" onClick={(e) => add(m, e)} aria-label={`Add ${m.name}`}>
                          Add <span aria-hidden="true">+</span>
                        </button>
                      ))}
                  </li>
                );
              })}
          </ul>
          <button type="button" className="tm-send" onClick={closeSheet}>
            Done
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet === "cart"} onClose={closeSheet} label="Your order">
        <div className="tm-ticket">
          <div className="tm-ticket__head">
            <span>Order ticket</span>
            <span>{view.tab ? "On your tab" : "New tab"}</span>
          </div>
          {lines.length === 0 ? (
            <p className="tm-ticket__empty">Your order is empty. Add something tasty!</p>
          ) : (
            <ul className="tm-lines">
              {lines.map((l) => {
                const bad = !l.item || l.item.soldOut || (l.item.left !== null && l.qty > l.item.left);
                return (
                  <li key={l.id} className={bad ? "is-bad" : ""}>
                    <div>
                      <b>{l.item?.name ?? "Item no longer available"}</b>
                      {l.item && <small>{rupee(l.item.price)} each</small>}
                      {bad && l.item && <em>{l.item.soldOut ? "Just sold out" : `Only ${l.item.left} left`}</em>}
                    </div>
                    {l.item && !l.item.soldOut ? (
                      <Stepper size="sm" qty={l.qty} max={maxFor(l.item)} name={l.item.name} onChange={(n) => setQty(l.id, n)} />
                    ) : (
                      <button type="button" className="tm-linkbtn" onClick={() => setQty(l.id, 0)}>
                        Remove
                      </button>
                    )}
                    <span className="tm-lines__amt">{l.item ? rupee(l.item.price * l.qty) : "—"}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <label className="tm-field">
            <span>Anything the kitchen should know?</span>
            <textarea rows={2} maxLength={240} placeholder="Less sugar in the chai, warm the brownie, a candle for the birthday…" value={guest.note} onChange={(e) => setGuest({ ...guest, note: e.target.value })} />
          </label>

          {needDetails && (
            <div className="tm-details">
              <p className="tm-details__why">So we can send your bill on WhatsApp</p>
              <div className="tm-details__row">
                {!view.tab && (
                  <label className="tm-field">
                    <span>Your name</span>
                    <input autoComplete="given-name" maxLength={60} value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} placeholder="Priya" />
                  </label>
                )}
                <label className="tm-field">
                  <span>Mobile (WhatsApp)</span>
                  <input inputMode="numeric" autoComplete="tel-national" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: tenDigits(e.target.value) })} placeholder="9876543210" />
                </label>
              </div>
            </div>
          )}

          <div className="tm-ticket__total">
            <span>Total</span>
            <b>{rupee(total)}</b>
          </div>
          {err && (
            <p className="tm-err" role="alert">
              {err}
            </p>
          )}
          <button type="button" className="tm-send" disabled={!count || busy} onClick={place}>
            {busy ? "Sending…" : "Send to the kitchen"}
            {!busy && <Arrow size={18} />}
          </button>
          <p className="tm-fine">Pay at the counter when you leave · prices include taxes</p>
        </div>
      </Sheet>

      {/* ================= tab sheet ================= */}
      <Sheet open={sheet === "tab"} onClose={closeSheet} label="Your tab">
        {tab ? (
          <div className="tm-tab">
            <div className="tm-tab__head">
              <div>
                <small>Your tab</small>
                <b>{rupee(tab.total)}</b>
              </div>
              <span>{liveOrders === 1 ? "1 order" : `${liveOrders} orders`}</span>
            </div>
            <ol className="tm-orders">
              {[...tab.orders].reverse().map((o) => {
                const at = STEPS.indexOf(o.status);
                return (
                  <li key={o.no} className={o.status === "cancelled" ? "is-x" : ""}>
                    <div className="tm-orders__top">
                      <b>Order #{o.no}</b>
                      <span>{time(o.createdAt)}</span>
                    </div>
                    {o.status === "cancelled" ? (
                      <p className="tm-orders__x">Cancelled by the kitchen — please ask our staff.</p>
                    ) : (
                      <div className="tm-track" style={{ "--at": at } as CSSVars}>
                        {STEPS.map((s, i) => (
                          <span key={s} className={i < at ? "is-done" : i === at ? "is-now" : ""}>
                            <i />
                            {STEP_LABEL[s]}
                          </span>
                        ))}
                      </div>
                    )}
                    <ul>
                      {o.items.map((it, i) => (
                        <li key={i}>
                          <span>
                            {it.qty} × {it.name}
                          </span>
                          <span>{rupee(it.price * it.qty)}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
            <CouponBox tab={tab} phone={phone} onView={setView} />
            {tab.coupon?.ok && (
              <div className="tm-tab__pay">
                <span>To pay after coupon</span>
                <b>{rupee(tab.payable)}</b>
              </div>
            )}
            <button type="button" className="tm-send" onClick={() => { setSheet(null); setFinish(true); }}>
              {tab.billRequested ? "See your bill" : "Finished eating? Wrap up"}
              <Arrow size={18} />
            </button>
            <button type="button" className="tm-send tm-send--ghost" onClick={() => setSheet(null)}>
              Order something else
            </button>
          </div>
        ) : (
          <p className="tm-ticket__empty">Nothing on your tab yet.</p>
        )}
      </Sheet>

      {/* ================= "finished eating?" bar ================= */}
      <div className={`tm-dbar ${doneBar ? "is-on" : ""}`} aria-hidden={!doneBar}>
        <button type="button" onClick={() => setFinish(true)} tabIndex={doneBar ? 0 : -1}>
          <span className="tm-dbar__t">
            {tab?.billRequested ? "Your bill is coming" : "Finished eating?"}
            <small>
              {rupee(tab?.total ?? 0)} on your tab
            </small>
          </span>
          <b>{tab?.billRequested ? "View" : "Get the bill"}</b>
          <Arrow size={18} />
        </button>
      </div>

      {/* ================= finish up ================= */}
      {finish && tab && !bye && (
        <div className="tm-bye" role="dialog" aria-modal="true" aria-label="Finish up">
          <div className="tm-bye__card tm-bye__card--bill">
            <div className="tm-rcpt">
              <div className="tm-rcpt__head">
                <Cherry size={26} />
                <b>{view.shopName}</b>
                {tab.name && <span>{tab.name}</span>}
              </div>
              <ul className="tm-rcpt__lines">
                {billLines.map((l, i) => (
                  <li key={i}>
                    <span>
                      {l.qty} × {l.name}
                    </span>
                    <span>{rupee(l.price * l.qty)}</span>
                  </li>
                ))}
              </ul>
              {tab.coupon?.ok && (
                <div className="tm-rcpt__disc">
                  <span>Coupon {tab.coupon.code}</span>
                  <b>-{rupee(tab.coupon.discount)}</b>
                </div>
              )}
              <div className="tm-rcpt__total">
                <span>{tab.coupon?.ok ? "To pay" : "Total"}</span>
                <b>{rupee(tab.payable)}</b>
              </div>
              {!tab.billRequested && <CouponBox tab={tab} phone={phone} onView={setView} />}
              <p className="tm-rcpt__fine">Any other discount is applied at the counter.</p>
            </div>

            {tab.upi && tab.payable > 0 && <UpiPay tab={tab} shop={view.shopName} phone={phone} onView={setView} />}

            {tab.billRequested ? (
              <div className="tm-billed tm-billed--big">
                <b>The counter knows — your bill is on its way ✺</b>
                <span>Settle it at the counter whenever you&apos;re ready.</span>
              </div>
            ) : (
              <button type="button" className="tm-send" disabled={busy} onClick={askBill}>
                {busy ? "Telling the counter…" : "Yes — I'm done, bring the bill"}
                {!busy && <Arrow size={18} />}
              </button>
            )}
            <button type="button" className="tm-send tm-send--ghost" onClick={() => setFinish(false)}>
              {tab.billRequested ? "Back to the menu" : "Not yet — order something else"}
            </button>
          </div>
        </div>
      )}

      {/* ================= paid up — goodbye, and a clean slate for the next guests ================= */}
      {bye && (
        <div className="tm-bye" role="dialog" aria-modal="true" aria-label="Thank you">
          <div className="tm-bye__card">
            {bye.kind === "paid" ? (
              <>
                <svg viewBox="0 0 80 80" className="tm-done__tick" aria-hidden="true">
                  <circle cx="40" cy="40" r="36" />
                  <path d="M24 41 l11 11 l22 -24" />
                </svg>
                <small>Paid · {bye.invoiceNo}</small>
                <h2>
                  Thank you{bye.name ? `, ${bye.name.split(" ")[0]}` : ""} <em>✺</em>
                </h2>
                <p className="tm-bye__amt">{rupee(bye.total)}</p>
                <p>
                  {bye.itemCount} item{bye.itemCount === 1 ? "" : "s"} settled at the counter. Hope to see you again soon!
                </p>
              </>
            ) : (
              <>
                <small>Tab closed</small>
                <h2>
                  Tab <em>cleared</em>
                </h2>
                <p>Our staff closed this tab without a bill. If that wasn&apos;t expected, please check at the counter.</p>
              </>
            )}
            <button type="button" className="tm-send" onClick={leave}>
              Start a fresh order
            </button>
            <p className="tm-fine">Nothing from this visit is kept on your phone.</p>
          </div>
        </div>
      )}

      {/* ================= sent! ================= */}
      {placed !== null && (
        <div className="tm-done" role="status">
          <div className="tm-done__card">
            <svg viewBox="0 0 80 80" className="tm-done__tick" aria-hidden="true">
              <circle cx="40" cy="40" r="36" />
              <path d="M24 41 l11 11 l22 -24" />
            </svg>
            <small>Order #{placed}</small>
            <h2>
              Sent to the <em>kitchen!</em>
            </h2>
            <p>We&apos;ll have it ready shortly. You can keep adding to your order anytime.</p>
            <div className="tm-done__btns">
              <button type="button" className="tm-send tm-send--ghost" onClick={() => { setPlaced(null); setSheet("tab"); }}>
                Track order
              </button>
              <button type="button" className="tm-send" onClick={() => setPlaced(null)}>
                Keep browsing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
