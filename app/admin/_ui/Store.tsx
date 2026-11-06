"use client";

import { subscribeChanges } from "@/lib/realtime";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { APPROVAL_VERBS, type AdminState, type Order, type Session } from "@/lib/types";
import type { Role } from "@/lib/auth";
import { round2, rupee } from "@/lib/money";

/* ------------------------------------------------------------------
   Admin data store: one copy of the server state, kept fresh by a
   cheap version poll, plus toasts / confirm / print helpers.
   ------------------------------------------------------------------ */

export type Toast = { id: number; kind: "ok" | "err" | "order" | "bill" | "info"; title: string; body?: string; href?: string };
type ConfirmReq = { title: string; body?: React.ReactNode; ok?: string; danger?: boolean };
/** `pending` = staff made a change that is now waiting for the admin's approval — nothing has changed yet. */
export type ActResult<T = unknown> = { ok: true; result: T; pending?: boolean } | { ok: false; error: string };
/** `optimistic` paints the expected result straight away and lets the server catch up in
    the background; if the server says no, the screen goes back to what the server has. */
export type ActOpts = { optimistic?: (s: AdminState) => AdminState };

/** One open tab, found by the customer's mobile. */
export type FloorTab = {
  session: Session;
  orders: Order[];
  total: number;
  items: number;
  fresh: number;
  cooking: number;
  billRequested: boolean;
};

type Ctx = {
  s: AdminState;
  /** Who's signed in — "admin" is the owner, "staff" is a cashier/cook. */
  role: Role;
  act: <T = unknown>(op: string, args?: Record<string, unknown>, opts?: ActOpts) => Promise<ActResult<T>>;
  refresh: () => Promise<void>;
  toast: (t: Omit<Toast, "id">) => void;
  toasts: Toast[];
  dismiss: (id: number) => void;
  confirm: (c: ConfirmReq) => Promise<boolean>;
  pending: ConfirmReq | null;
  answer: (v: boolean) => void;
  print: (node: React.ReactNode) => void;
  printNode: React.ReactNode;
  sound: boolean;
  setSound: (v: boolean) => void;
  base: string;
  now: number;
  floor: FloorTab[];
};

/** Who a tab, order or bill belongs to, as staff read it: name first, then mobile. */
export const whoIs = (x: { customerName: string; customerPhone: string }) => x.customerName || x.customerPhone || "Guest";

const C = createContext<Ctx | null>(null);

export function useAdmin() {
  const c = useContext(C);
  if (!c) throw new Error("useAdmin outside AdminProvider");
  return c;
}

const itemsText = (o: Order) => o.items.map((i) => `${i.qty}× ${i.name}`).join(", ");

/* the chime on/off switch lives in localStorage, read as an external store */
const soundSubs = new Set<() => void>();
const soundPref = {
  subscribe: (cb: () => void) => (soundSubs.add(cb), () => void soundSubs.delete(cb)),
  get: () => {
    try {
      return localStorage.getItem("clc-admin-sound") !== "0";
    } catch {
      return true;
    }
  },
  set: (v: boolean) => {
    try {
      localStorage.setItem("clc-admin-sound", v ? "1" : "0");
    } catch {}
    soundSubs.forEach((f) => f());
  },
};
const noop = () => () => {};

export function AdminProvider({ initial, role, children }: { initial: AdminState; role: Role; children: React.ReactNode }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<ConfirmReq | null>(null);
  const [printNode, setPrintNode] = useState<React.ReactNode>(null);
  const [printTick, setPrintTick] = useState(0);
  const sound = useSyncExternalStore(soundPref.subscribe, soundPref.get, () => true);
  const origin = useSyncExternalStore(noop, () => window.location.origin, () => "");
  const [now, setNow] = useState(() => Date.now());
  const version = useRef(initial.version);
  /* Optimistic writes in flight, and a counter that moves each time one starts. A poll
     that began before a write, or lands while one is still pending, carries older data
     than the screen shows — applying it would flick the number back and forth. */
  const writes = useRef(0);
  const writeGen = useRef(0);
  const reload = useRef(false);
  const resolver = useRef<((v: boolean) => void) | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const tid = useRef(0);

  /* ---------- toasts ---------- */
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++tid.current;
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === "order" || t.kind === "bill" ? 12000 : t.kind === "err" ? 7000 : 4000);
    },
    [dismiss],
  );

  /* ---------- sound ---------- */
  useEffect(() => {
    const unlock = () => {
      try {
        audio.current ??= new AudioContext();
        if (audio.current.state === "suspended") audio.current.resume();
      } catch {}
    };
    window.addEventListener("pointerdown", unlock);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      clearInterval(clock);
    };
  }, []);

  const setSound = useCallback((v: boolean) => soundPref.set(v), []);

  const chime = useCallback(() => {
    const c = audio.current;
    if (!soundPref.get() || !c || c.state !== "running") return;
    const t = c.currentTime;
    [988, 1319, 1568].forEach((f, i) => {
      const o = c.createOscillator();
      const g = c.createGain();
      const at = t + i * 0.12;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      o.connect(g).connect(c.destination);
      o.start(at);
      o.stop(at + 0.5);
    });
  }, []);

  /* ---------- sync ---------- */
  const poll = useCallback(
    async (force = false) => {
      const gen = writeGen.current;
      try {
        const r = await fetch(`/api/admin/state?since=${force ? 0 : version.current}`, { cache: "no-store" });
        if (r.status === 401) return router.replace("/admin/login");
        if (!r.ok) return;
        const d = await r.json();
        if (d.same) return;
        if (writes.current > 0 || gen !== writeGen.current) return; // stale next to what's on screen; the last write re-polls
        version.current = d.version;
        setS(d);
      } catch {}
    },
    [router],
  );

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(async () => {
        await poll();
        loop();
      }, document.visibilityState === "visible" ? 20000 : 60000);
    };
    loop();
    const onVis = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [poll]);

  /* Live signal: the server nudges every open screen after each write, so a new
     order shows up at once. The timer above is only the safety net. */
  useEffect(() => subscribeChanges(() => void poll()), [poll]);

  const act = useCallback(
    async <T,>(op: string, args: Record<string, unknown> = {}, opts: ActOpts = {}): Promise<ActResult<T>> => {
      const fast = !!opts.optimistic;
      if (opts.optimistic) {
        writes.current++;
        writeGen.current++;
        setS(opts.optimistic);
      }
      let ok = false;
      try {
        const r = await fetch("/api/admin/op", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...args, op }) });
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) {
          router.replace("/admin/login");
          return { ok: false, error: d.error ?? "Signed out" };
        }
        if (!r.ok) {
          toast({ kind: "err", title: d.error ?? "Something went wrong." });
          return { ok: false, error: d.error ?? "error" };
        }
        ok = true;
        if (!fast) await poll();
        if (d.result && typeof d.result === "object" && (d.result as { pendingApproval?: boolean }).pendingApproval) {
          toast({ kind: "info", title: "Sent to the admin for approval", body: "It takes effect once the admin approves it." });
          return { ok: true, result: d.result as T, pending: true };
        }
        return { ok: true, result: d.result as T };
      } catch {
        toast({ kind: "err", title: "Network problem — check the connection and try again." });
        return { ok: false, error: "network" };
      } finally {
        if (fast) {
          if (!ok) reload.current = true;
          /* the last write out puts the screen back in line with the server — in the
             background, so the next click never waits on it */
          if (--writes.current === 0) {
            const force = reload.current;
            reload.current = false;
            void poll(force);
          }
        }
      }
    },
    [poll, router, toast],
  );

  /* ---------- live alerts: new orders, bill requests ---------- */
  const seen = useRef({
    orders: new Set(initial.orders.map((o) => o.id)),
    bills: new Set(initial.sessions.filter((x) => x.billRequestedAt).map((x) => x.id)),
    claims: new Set(initial.sessions.filter((x) => x.payClaimedAt).map((x) => `${x.id}:${x.payClaimedAt}`)),
  });
  useEffect(() => {
    let ring = false;
    for (const o of s.orders) {
      if (seen.current.orders.has(o.id)) continue;
      seen.current.orders.add(o.id);
      if (o.status !== "new") continue;
      ring = true;
      toast({ kind: "order", title: `New order #${o.no} · ${whoIs(o)}`, body: itemsText(o), href: "/admin" });
    }
    for (const x of s.sessions) {
      if (!x.billRequestedAt || x.status !== "open" || seen.current.bills.has(x.id)) continue;
      seen.current.bills.add(x.id);
      ring = true;
      toast({ kind: "bill", title: `${whoIs(x)} asked for the bill`, body: `${x.customerName || "A guest"} is ready to pay.`, href: `/admin/billing?tab=${x.id}` });
    }
    for (const x of s.sessions) {
      if (!x.payClaimedAt || x.status !== "open") continue;
      const k = `${x.id}:${x.payClaimedAt}`;
      if (seen.current.claims.has(k)) continue;
      seen.current.claims.add(k);
      ring = true;
      toast({ kind: "bill", title: `${whoIs(x)} says they paid ${rupee(x.payClaimedAmount)} by UPI`, body: "Check your UPI app, then bill the tab.", href: `/admin/billing?tab=${x.id}` });
    }
    if (ring) chime();
  }, [s, toast, chime]);

  /* ---------- approvals ----------
     The admin is told (popup + chime) when staff ask for a change; staff are told how it ended. */
  const apprSeen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const now = new Map(s.approvals.map((x) => [x.id, x.status + ":" + x.createdAt]));
    const prev = apprSeen.current;
    apprSeen.current = now;
    if (!prev) return;
    let ring = false;
    for (const x of s.approvals) {
      const before = prev.get(x.id);
      if (before === now.get(x.id)) continue;
      if (role === "admin" && x.status === "pending") {
        ring = true;
        toast({ kind: "info", title: `${x.requestedBy} wants to ${APPROVAL_VERBS[x.kind] ?? x.kind} ${x.targetName}`, body: "Approve or reject it in the popup." });
      } else if (role !== "admin" && before?.startsWith("pending") && x.status !== "pending") {
        toast({ kind: x.status === "approved" ? "ok" : "err", title: x.status === "approved" ? `Admin approved: ${x.targetName}` : `Admin rejected the change to ${x.targetName}` });
      }
    }
    if (ring) chime();
  }, [s.approvals, role, toast, chime]);

  /* ---------- low-stock alerts ----------
     An item alerts when it falls to its warning level ("low") or hits zero ("out") — once per
     change, not on every refresh. On first load one summary says how many are already low. */
  const stockSeen = useRef<Map<string, "low" | "out"> | null>(null);
  useEffect(() => {
    const now = new Map<string, "low" | "out">();
    const names = new Map<string, string>();
    for (const p of s.products) {
      if (!p.active || p.stock === null) continue;
      if (p.stock <= 0) now.set(`p:${p.id}`, "out");
      else if (p.stock <= p.lowAt) now.set(`p:${p.id}`, "low");
      names.set(`p:${p.id}`, `${p.name} (${p.stock} left)`);
    }
    for (const i of s.ingredients ?? []) {
      if (!i.active || !(i.lowAt > 0)) continue;
      if (i.stock <= 0) now.set(`i:${i.id}`, "out");
      else if (i.stock <= i.lowAt) now.set(`i:${i.id}`, "low");
      names.set(`i:${i.id}`, `${i.name} (${i.stock} ${i.unit} left)`);
    }
    const prev = stockSeen.current;
    stockSeen.current = now;
    if (!prev) {
      if (now.size) toast({ kind: "info", title: `${now.size} item${now.size === 1 ? " is" : "s are"} low on stock`, body: "Open Inventory to restock.", href: "/admin/inventory" });
      return;
    }
    const worse = [...now].filter(([k, v]) => prev.get(k) !== v && !(prev.get(k) === "out" && v === "low"));
    if (!worse.length) return;
    const out = worse.filter(([, v]) => v === "out").length;
    toast({
      kind: "info",
      title: out ? `${out} item${out === 1 ? "" : "s"} sold out · ${worse.length - out} low` : `Low stock: ${worse.length} item${worse.length === 1 ? "" : "s"}`,
      body: worse.slice(0, 3).map(([k]) => names.get(k)).join(", ") + (worse.length > 3 ? ` +${worse.length - 3} more` : ""),
      href: "/admin/inventory",
    });
    chime();
  }, [s, toast, chime]);

  /* ---------- confirm ---------- */
  const confirm = useCallback((c: ConfirmReq) => {
    setPending(c);
    return new Promise<boolean>((res) => (resolver.current = res));
  }, []);
  const answer = useCallback((v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setPending(null);
  }, []);

  /* ---------- print ---------- */
  const print = useCallback((node: React.ReactNode) => {
    setPrintNode(node);
    setPrintTick((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!printTick) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => cancelAnimationFrame(r);
  }, [printTick]);

  /* ---------- derived floor: every open tab, oldest first ---------- */
  const floor = useMemo<FloorTab[]>(() => {
    return s.sessions
      .filter((session) => session.status === "open")
      .map((session) => {
        const orders = s.orders.filter((o) => o.sessionId === session.id);
        const live = orders.filter((o) => o.status !== "cancelled");
        return {
          session,
          orders,
          total: round2(live.reduce((a, o) => a + o.subtotal, 0)),
          items: live.reduce((a, o) => a + o.items.reduce((b, i) => b + i.qty, 0), 0),
          fresh: orders.filter((o) => o.status === "new").length,
          cooking: orders.filter((o) => o.status === "preparing").length,
          billRequested: !!session.billRequestedAt,
        };
      });
  }, [s.sessions, s.orders]);

  const base = (s.settings.publicUrl || origin).replace(/\/+$/, "");

  const value: Ctx = {
    s,
    role,
    act,
    refresh: poll,
    toast,
    toasts,
    dismiss,
    confirm,
    pending,
    answer,
    print,
    printNode,
    sound,
    setSound,
    base,
    now,
    floor,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
