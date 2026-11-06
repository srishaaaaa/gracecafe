"use client";

/* Sends one offer — a points campaign or a coupon — to the customers it is meant for, on
   WhatsApp: loyalty members, customers who are not members, or everyone. WhatsApp can't be
   bulk-sent from a browser, so each customer gets their own Send button; sent ones are
   ticked off. Members who have not agreed to offers, or whose account is deactivated, are
   never listed. Non-members come from the bills that have their mobile number. */

import { useMemo, useState } from "react";
import type { LoyaltyCustomer } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { waLink } from "../receipt";
import { Btn, Empty, Field, Modal, WaIcon, cx, fmtDate, inputLineCls } from "../kit";
import { useLoyaltyState } from "./shared";

export type Recipient = { customer: LoyaltyCustomer };
export type Scope = "members" | "nonMembers" | "everyone";

type Row = { key: string; name: string; phone: string; sub: string; member: boolean };

export function OfferSend({ title, template, who, scope = "members", filter, onSent, onClose }: { title: string; template: string; who: string; scope?: Scope; filter?: (r: Recipient) => boolean; onSent?: (c: { name: string; phone: string }) => void | Promise<unknown>; onClose: () => void }) {
  const { s } = useAdmin();
  const { data, error } = useLoyaltyState();
  const [tpl, setTpl] = useState(template);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const shop = s.settings.shopName;

  const list = useMemo<Row[]>(() => {
    if (!data) return [];
    const out: Row[] = [];
    if (scope !== "nonMembers") {
      for (const c of data.customers) {
        if (c.status !== "active" || !c.consent) continue;
        if (filter && !filter({ customer: c })) continue;
        out.push({ key: c.id, name: c.name, phone: c.whatsapp || c.phone, sub: "Loyalty customer", member: true });
      }
    }
    if (scope !== "members") {
      const members = new Set(data.customers.map((c) => c.phone));
      const by = new Map<string, { name: string; visits: number; last: number }>();
      for (const b of s.bills) {
        if (b.status !== "completed" || !/^[6-9]\d{9}$/.test(b.customerPhone) || members.has(b.customerPhone)) continue;
        const x = by.get(b.customerPhone) ?? { name: "", visits: 0, last: 0 };
        x.visits++;
        if (b.createdAt >= x.last) {
          x.last = b.createdAt;
          if (b.customerName && b.customerName !== "Walk-in customer") x.name = b.customerName;
        }
        by.set(b.customerPhone, x);
      }
      for (const [phone, x] of [...by].sort((a, b) => b[1].last - a[1].last)) out.push({ key: phone, name: x.name || "Customer", phone, sub: `Not a member · ${x.visits} bill${x.visits === 1 ? "" : "s"} · last ${fmtDate(x.last)}`, member: false });
    }
    return scope === "members" ? out.sort((a, b) => a.name.localeCompare(b.name)) : out;
  }, [data, filter, scope, s.bills]);

  const text = (r: Row) => tpl.replaceAll("{name}", r.name.split(" ")[0] || "there").replaceAll("{shop}", shop);
  const mark = (r: Row) => {
    setSent((x) => new Set(x).add(r.key));
    void onSent?.({ name: r.name, phone: r.phone });
  };
  const who2 = scope === "members" ? "loyalty member" : scope === "nonMembers" ? "customer" : "customer";

  return (
    <Modal open wide onClose={onClose} title={title} footer={<Btn onClick={onClose}>Done{sent.size ? ` · ${sent.size} sent` : ""}</Btn>}>
      <div className="space-y-4">
        <Field label="Message" hint="{name} and {shop} are filled in for each customer.">
          <textarea className={cx(inputLineCls, "h-28 resize-y py-2.5 leading-relaxed")} value={tpl} maxLength={1000} onChange={(e) => setTpl(e.target.value)} />
        </Field>
        <p className="text-[12.5px] font-semibold text-slate-600">{data ? `${list.length} ${who2}${list.length === 1 ? "" : "s"} for ${who}` : error || "Loading customers…"}</p>
        {scope !== "members" && <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] text-amber-800">Customers who are not loyalty members haven&apos;t been asked about WhatsApp offers — send only to people who are happy to get them.</p>}
        {data && !list.length ? (
          <Empty icon="users" title="No customers to send to">
            {scope === "members" ? "Only active members who agreed to WhatsApp offers are listed." : "Customers appear here once a bill is saved with their mobile number."}
          </Empty>
        ) : (
          <ul className="adm-scroll max-h-[340px] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-100">
            {list.map((r) => (
              <li key={r.key} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="min-w-0">
                  <b className="block truncate text-[13.5px] text-slate-900">{r.name}</b>
                  <span className="text-[11.5px] text-slate-500">
                    {r.phone} · {r.sub}
                  </span>
                </span>
                <a
                  href={waLink(r.phone, text(r))}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => mark(r)}
                  className={cx("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[12px] font-extrabold uppercase tracking-wide", sent.has(r.key) ? "border border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-[#22c55e] text-white hover:bg-[#16a34a]")}
                >
                  <WaIcon size={14} /> {sent.has(r.key) ? "Sent ✓ · again" : "Send"}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
