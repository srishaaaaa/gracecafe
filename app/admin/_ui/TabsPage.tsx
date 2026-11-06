"use client";

import Link from "next/link";
import { useState } from "react";
import type { Order } from "@/lib/types";
import { rupee } from "@/lib/money";
import { useAdmin, whoIs, type FloorTab } from "./Store";
import { Qr, downloadQrPng } from "./Qr";
import Catalog from "./Catalog";
import { Badge, Btn, Drawer, Empty, Field, Icon, Kpi, Modal, Page, PageHead, SearchBox, ago, cx, fmtTime, inputCls, type BadgeTone } from "./kit";

const ORDER_BADGE: Record<Order["status"], [BadgeTone, string]> = {
  new: ["red", "New"],
  preparing: ["amber", "Preparing"],
  served: ["green", "Served"],
  cancelled: ["slate", "Cancelled"],
};

function status(f: FloorTab): { tone: BadgeTone; label: string; bar: string } {
  if (f.session.payClaimedAt) return { tone: "green", label: "Says paid by UPI", bar: "bg-emerald-500" };
  if (f.session.billApprovedAt) return { tone: "sky", label: "Approved · awaiting UPI", bar: "bg-sky-500" };
  if (f.billRequested) return { tone: "amber", label: "Bill requested", bar: "bg-amber-400" };
  if (f.fresh) return { tone: "red", label: `${f.fresh} new order${f.fresh > 1 ? "s" : ""}`, bar: "bg-red-600" };
  return { tone: "green", label: "Open", bar: "bg-emerald-500" };
}

/** The shop's one QR card, two to an A4 page. */
export function QrSheet({ base, shop }: { base: string; shop: string }) {
  return (
    <div className="qr-sheet">
      {[0, 1].map((i) => (
        <div className="qr-card" key={i}>
          <span className="qr-card__brand">{shop}</span>
          <span className="qr-card__lead">Scan &amp; order</span>
          <div className="qr-card__qr">
            <Qr text={base} />
          </div>
          <span className="qr-card__cta">Browse the menu and order from your phone</span>
          <span className="qr-card__url">{base}</span>
        </div>
      ))}
    </div>
  );
}

export default function TabsPage({ focus }: { focus?: string }) {
  const { s, floor, act, confirm, toast, base, now, print } = useAdmin();
  const [sel, setSel] = useState<string | null>(focus ?? null);
  const [guestForm, setGuestForm] = useState<null | { id: string; customerName: string; customerPhone: string }>(null);
  const [startForm, setStartForm] = useState<null | { name: string; phone: string }>(null);
  const [addFor, setAddFor] = useState<null | { sessionId: string } | { name: string; phone: string }>(null);
  const [q, setQ] = useState("");

  const [lastFocus, setLastFocus] = useState(focus);
  if (focus !== lastFocus) {
    setLastFocus(focus);
    if (focus) setSel(focus);
  }

  const f = floor.find((x) => x.session.id === sel) ?? null;
  const needle = q.trim().toLowerCase();
  const shown = floor.filter((x) => !needle || `${x.session.customerName} ${x.session.customerPhone}`.toLowerCase().includes(needle));
  const running = floor.reduce((a, x) => a + x.total, 0);
  const fresh = floor.reduce((a, x) => a + x.fresh, 0);
  const billReq = floor.filter((x) => x.billRequested).length;
  const localOnly = /\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(base);

  const setOrder = async (o: Order, next: Order["status"]) => {
    if (next === "cancelled") {
      const ok = await confirm({ title: `Cancel order #${o.no}?`, body: "Its items go back into stock and drop off the tab's bill.", ok: "Cancel order", danger: true });
      if (!ok) return;
    }
    await act("order.status", { id: o.id, status: next });
  };

  const addTitle = addFor ? ("sessionId" in addFor ? whoIs(floor.find((x) => x.session.id === addFor.sessionId)?.session ?? { customerName: "", customerPhone: "" }) : addFor.name || addFor.phone) : "";

  return (
    <Page>
      <PageHead
        title="Open tabs"
        sub="Every guest's running tab, found by their mobile number."
        right={
          <>
            <Btn icon="print" onClick={() => print(<QrSheet base={base} shop={s.settings.shopName} />)}>
              Print QR card
            </Btn>
            <Btn kind="red" icon="plus" onClick={() => setStartForm({ name: "", phone: "" })}>
              Start a tab
            </Btn>
          </>
        }
      />

      {localOnly && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          <Icon name="alert" size={18} className="text-amber-600" />
          <span className="flex-1">
            The QR code points to <b>{base}</b>, which guests&apos; phones can&apos;t open. Set the address phones use (your domain or this computer&apos;s Wi-Fi IP) in <b>Settings</b> before printing.
          </span>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi label="Open tabs" value={floor.length} hint="Guests with a running tab" icon="users" tone="emerald" />
        <Kpi label="Running on tabs" value={rupee(running)} hint="Not yet billed" icon="rupee" tone="sky" />
        <Kpi label="New orders" value={fresh} hint="Waiting to be accepted" icon="utensils" tone={fresh ? "red" : "slate"} />
        <Kpi label="Bill requests" value={billReq} hint="Guests ready to pay" icon="billing" tone={billReq ? "amber" : "slate"} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Find a tab by name or mobile" className="w-full sm:w-80" />
        <span className="flex items-center gap-2 text-[12px] text-slate-400">
          Guests order at
          <a href={base} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-600 hover:underline">
            {base}
          </a>
          <button
            type="button"
            className="font-semibold text-slate-500 hover:text-slate-800"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(base);
                toast({ kind: "ok", title: "Link copied" });
              } catch {
                toast({ kind: "err", title: "Couldn't copy — select the link and copy it manually." });
              }
            }}
          >
            Copy
          </button>
          <button type="button" className="font-semibold text-slate-500 hover:text-slate-800" onClick={() => downloadQrPng(base, "order-qr.png")}>
            QR PNG
          </button>
        </span>
      </div>

      {!floor.length ? (
        <Empty icon="qr" title="No open tabs">
          A tab opens when a guest sends their first order. Taking an order by hand? Use <b>Start a tab</b>.
        </Empty>
      ) : !shown.length ? (
        <Empty icon="search" title="No tab matches">
          Nothing open for &ldquo;{q}&rdquo;.
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {shown.map((x) => {
            const st = status(x);
            return (
              <button
                key={x.session.id}
                type="button"
                onClick={() => setSel(x.session.id)}
                className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_28px_-12px_rgba(15,23,42,.25)]"
              >
                <span className={cx("absolute inset-x-0 top-0 h-1", st.bar)} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[18px] font-extrabold leading-tight text-slate-900">{x.session.customerName || "Guest"}</p>
                    <p className="adm-num mt-1 text-[13px] font-medium text-slate-500">{x.session.customerPhone}</p>
                  </div>
                  <Badge tone={st.tone} className={cx((x.fresh > 0 || x.billRequested) && "adm-pulse")}>
                    {st.label}
                  </Badge>
                </div>
                <div className="mt-4 border-t border-dashed border-slate-200 pt-4">
                  <div className="flex items-end justify-between gap-2">
                    <p className="adm-num text-[20px] font-extrabold text-slate-900">{rupee(x.total)}</p>
                    <p className="flex items-center gap-1 text-[12px] font-medium text-slate-400">
                      <Icon name="clock" size={13} /> {ago(x.session.openedAt, now)}
                    </p>
                  </div>
                  <p className="mt-1 text-[12.5px] text-slate-500">
                    {(() => {
                      const n = x.orders.filter((o) => o.status !== "cancelled").length;
                      return `${n} order${n === 1 ? "" : "s"} · ${x.items} item${x.items === 1 ? "" : "s"}`;
                    })()}
                    {x.cooking ? <span className="text-amber-600"> · {x.cooking} cooking</span> : null}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* ================= tab drawer ================= */}
      <Drawer open={!!f} onClose={() => setSel(null)}>
        {f && (
          <>
            <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-100 bg-white px-5 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <h2 className="truncate text-[20px] font-extrabold text-slate-900">{f.session.customerName || "Guest"}</h2>
                  <Badge tone={status(f).tone}>{status(f).label}</Badge>
                </div>
                <p className="adm-num text-[12px] text-slate-400">{f.session.customerPhone}</p>
              </div>
              <button
                type="button"
                className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100"
                title="Edit guest"
                onClick={() => setGuestForm({ id: f.session.id, customerName: f.session.customerName, customerPhone: f.session.customerPhone })}
              >
                <Icon name="edit" size={17} />
              </button>
              <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100" onClick={() => setSel(null)} aria-label="Close">
                <Icon name="x" />
              </button>
            </div>

            <div className="space-y-5 px-5 py-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Running total</p>
                    <p className="adm-num mt-1 text-[25px] font-extrabold text-slate-900">{rupee(f.total)}</p>
                  </div>
                  <div className="text-right text-[12px] text-slate-500">
                    <p>Opened {fmtTime(f.session.openedAt)}</p>
                    <p>{ago(f.session.openedAt, now)} ago</p>
                  </div>
                </div>
                {f.session.payClaimedAt && (
                  <p className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-100 px-3 py-2 text-[12.5px] font-semibold text-emerald-900">
                    <Icon name="rupee" size={15} /> Guest says they paid {rupee(f.session.payClaimedAmount)} by UPI — check your UPI app
                  </p>
                )}
                {f.billRequested && (
                  <p className="mt-3 flex items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-[12.5px] font-semibold text-amber-900">
                    <Icon name="billing" size={15} /> Guest asked for the bill
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Link href={`/admin/billing?tab=${f.session.id}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-red-600 text-[13px] font-semibold text-white shadow-[0_6px_16px_-8px_rgba(107, 117, 80,.8)] hover:bg-red-700">
                  <Icon name="billing" size={16} /> Bill this tab
                </Link>
                <Btn size="lg" icon="plus" onClick={() => setAddFor({ sessionId: f.session.id })} className="h-11">
                  Add items
                </Btn>
              </div>

              <div>
                <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Orders on this tab</p>
                <ol className="space-y-3">
                  {[...f.orders].reverse().map((o) => (
                    <li key={o.id} className={cx("rounded-2xl border p-4", o.status === "new" ? "border-red-200 bg-red-50/30" : "border-slate-100", o.status === "cancelled" && "opacity-55")}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[14px] font-bold text-slate-900">
                          #{o.no} <span className="font-medium text-slate-400">· {fmtTime(o.createdAt)}</span>
                        </p>
                        <Badge tone={ORDER_BADGE[o.status][0]}>{ORDER_BADGE[o.status][1]}</Badge>
                      </div>
                      <ul className="mt-2 space-y-1 text-[13px]">
                        {o.items.map((it, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span className={cx("text-slate-700", o.status === "cancelled" && "line-through")}>
                              <b>{it.qty}×</b> {it.name}
                            </span>
                            <span className="text-slate-500">{rupee(it.price * it.qty)}</span>
                          </li>
                        ))}
                      </ul>
                      {o.note && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">“{o.note}”</p>}
                      {(o.status === "new" || o.status === "preparing") && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {o.status === "new" ? (
                            <Btn size="sm" kind="dark" icon="check" onClick={() => setOrder(o, "preparing")}>
                              Accept &amp; prepare
                            </Btn>
                          ) : (
                            <Btn size="sm" kind="green" icon="check" onClick={() => setOrder(o, "served")}>
                              Mark served
                            </Btn>
                          )}
                          {o.status === "new" && (
                            <Btn size="sm" onClick={() => setOrder(o, "served")}>
                              Served
                            </Btn>
                          )}
                          <Btn size="sm" kind="plain" className="text-red-600" onClick={() => setOrder(o, "cancelled")}>
                            Cancel
                          </Btn>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              <button
                type="button"
                className="text-[12.5px] font-semibold text-slate-400 underline-offset-2 hover:text-red-600 hover:underline"
                onClick={async () => {
                  if (
                    await confirm({
                      title: `Clear ${whoIs(f.session)}'s tab without billing?`,
                      body:
                        f.total > 0
                          ? `${rupee(f.total)} on this tab will NOT be recorded as a sale — it drops out of Billing and Analytics for good. Unserved orders are cancelled and their stock returned. To take the payment and keep the sale, use “Bill this tab” instead.`
                          : "Use this if the guest left without ordering or the tab was opened by mistake. Unserved orders are cancelled and their stock returned.",
                      ok: "Clear tab",
                      danger: true,
                    })
                  ) {
                    const r = await act("tab.clear", { id: f.session.id });
                    if (r.ok) setSel(null);
                  }
                }}
              >
                Clear tab without billing
              </button>
            </div>
          </>
        )}
      </Drawer>

      {/* ================= start a tab by hand ================= */}
      <Modal
        open={!!startForm}
        onClose={() => setStartForm(null)}
        title="Start a tab"
        footer={
          <>
            <Btn onClick={() => setStartForm(null)}>Cancel</Btn>
            <Btn
              kind="red"
              onClick={() => {
                const phone = startForm!.phone.replace(/\D/g, "").slice(-10);
                if (!/^[6-9]\d{9}$/.test(phone)) return toast({ kind: "err", title: "Enter a valid 10-digit mobile number." });
                const open = floor.find((x) => x.session.customerPhone === phone);
                if (open) {
                  setStartForm(null);
                  setSel(open.session.id);
                  return toast({ kind: "info", title: "That number already has an open tab — opened it." });
                }
                setAddFor({ name: startForm!.name.trim(), phone });
                setStartForm(null);
              }}
            >
              Choose items
            </Btn>
          </>
        }
      >
        {startForm && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input className={inputCls} value={startForm.name} maxLength={60} onChange={(e) => setStartForm({ ...startForm, name: e.target.value })} placeholder="Priya" />
            </Field>
            <Field label="Mobile">
              <input className={inputCls} inputMode="tel" value={startForm.phone} onChange={(e) => setStartForm({ ...startForm, phone: e.target.value })} placeholder="9876543210" />
            </Field>
          </div>
        )}
      </Modal>

      {/* ================= guest details ================= */}
      <Modal
        open={!!guestForm}
        onClose={() => setGuestForm(null)}
        title="Guest details"
        footer={
          <>
            <Btn onClick={() => setGuestForm(null)}>Cancel</Btn>
            <Btn
              kind="red"
              onClick={async () => {
                const r = await act("session.update", guestForm!);
                if (r.ok) setGuestForm(null);
              }}
            >
              Save
            </Btn>
          </>
        }
      >
        {guestForm && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" className="sm:col-span-3">
              <input className={inputCls} value={guestForm.customerName} onChange={(e) => setGuestForm({ ...guestForm, customerName: e.target.value })} />
            </Field>
            <Field label="Mobile" className="sm:col-span-3">
              <input className={inputCls} inputMode="tel" value={guestForm.customerPhone} onChange={(e) => setGuestForm({ ...guestForm, customerPhone: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>

      {/* ================= add items to a tab ================= */}
      <Catalog
        open={!!addFor}
        onClose={() => setAddFor(null)}
        title={`Add items · ${addTitle}`}
        addLabel="Add to tab"
        onAdd={async (items) => {
          const r = await act<{ id: string; sessionId: string }>("order.create", { ...addFor, items });
          if (r.ok) {
            toast({ kind: "ok", title: "Added to the tab — marked as preparing." });
            if (addFor && !("sessionId" in addFor)) setSel(r.result.sessionId);
          }
          return r.ok;
        }}
      />
    </Page>
  );
}
