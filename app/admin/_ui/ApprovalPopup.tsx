"use client";

import { useState } from "react";
import { APPROVAL_VERBS, INGREDIENT_UNITS, type ApprovalRequest } from "@/lib/types";
import { useAdmin } from "./Store";
import { Badge, Btn, Modal, cx } from "./kit";

/* Pops up for the admin whenever staff ask to change something — an ingredient, a product, a
   bill's details, a loyalty member, a reward or campaign. Nothing changes until the admin
   presses Approve; Reject leaves it as it is. "Decide later" only hides the popup until the
   next request comes in. */

const SKIP = new Set(["id", "op", "image", "track", "createdAt", "updatedAt", "tags"]);
const humanize = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

function fmt(k: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (k === "unit") return INGREDIENT_UNITS.find((u) => u.key === v)?.label ?? String(v);
  if (Array.isArray(v) && v.length && typeof v[0] === "object") return v.map((i: { qty?: number; name?: string; price?: number }) => `${i.qty}× ${i.name} @ ₹${i.price}`).join(", ");
  if (Array.isArray(v)) return v.join(", ") || "—";
  return String(v);
}

function Details({ r }: { r: ApprovalRequest }) {
  const b = r.before ?? {};
  if (r.kind.endsWith(".delete")) {
    return <p className="rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-800">Remove <b>{r.targetName}</b>. Past records stay.</p>;
  }
  const rows = Object.entries(r.payload)
    .filter(([k, v]) => !SKIP.has(k) && (typeof v !== "object" || v === null || Array.isArray(v)) && fmt(k, v).length <= 600)
    .map(([k, v]) => ({ k, was: k in b ? fmt(k, b[k]) : null, now: fmt(k, v) }))
    // changed fields, and fields that have no "before" (e.g. the reason for a points adjustment)
    .filter((x) => x.was === null || x.was !== x.now);
  if (!rows.length) return <p className="rounded-xl bg-slate-50 px-4 py-3 text-[13px] text-slate-600">No visible change in the details.</p>;
  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">
          <th className="pb-1" />
          <th className="pb-1">Now</th>
          <th className="pb-1">Staff want</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.k} className="border-b border-slate-100 last:border-0">
            <td className="py-2 pr-3 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">{humanize(x.k)}</td>
            <td className={cx("py-2 pr-3 text-[13px]", x.was !== null ? "text-slate-400 line-through" : "text-slate-400")}>{x.was ?? "—"}</td>
            <td className="py-2 text-[13px] font-bold text-emerald-700">{x.now}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ApprovalPopup() {
  const { s, act, toast } = useAdmin();
  const pending = s.approvals.filter((x) => x.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
  const key = pending.map((x) => `${x.id}:${x.createdAt}`).join(",");
  const [hidden, setHidden] = useState("");
  const [busy, setBusy] = useState(false);
  const r = pending[0];
  if (!r || hidden === key) return null;
  const removal = r.kind.endsWith(".delete");

  const decide = async (approve: boolean) => {
    setBusy(true);
    const res = await act(approve ? "approval.approve" : "approval.reject", { id: r.id });
    setBusy(false);
    if (res.ok) toast({ kind: "ok", title: approve ? `Approved — ${r.targetName} updated` : "Request rejected — nothing changed" });
  };

  return (
    <Modal
      open
      onClose={() => setHidden(key)}
      title={
        <span className="flex items-center gap-2">
          Approval needed <Badge tone="amber">{pending.length > 1 ? `1 of ${pending.length}` : "1 request"}</Badge>
        </span>
      }
      footer={
        <>
          <Btn kind="plain" disabled={busy} onClick={() => setHidden(key)}>
            Decide later
          </Btn>
          <Btn disabled={busy} onClick={() => decide(false)}>
            Reject
          </Btn>
          <Btn kind={removal ? "red" : "dark"} disabled={busy} onClick={() => decide(true)}>
            {busy ? "Working…" : removal ? "Approve & remove" : "Approve & save"}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13.5px] text-slate-700">
          <b className="capitalize">{r.requestedBy}</b> wants to {APPROVAL_VERBS[r.kind] ?? r.kind} <b>{r.targetName}</b>. It changes only if you approve.
        </p>
        <Details r={r} />
      </div>
    </Modal>
  );
}
