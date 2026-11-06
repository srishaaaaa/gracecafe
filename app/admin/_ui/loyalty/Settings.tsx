"use client";

import { useState } from "react";
import { round2 } from "@/lib/money";
import { redeemRange } from "@/lib/loyalty/engine";
import { DEFAULT_CONFIG, MESSAGE_FIELDS, MESSAGE_META, crmWarnings, rangeWarnings, type LoyaltyConfig, type MessageKey, type RedeemRange } from "@/lib/loyalty/config";
import type { LoyaltyState } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Btn, Card, Field, Switch as RawSwitch, cx, downloadExcel, inputLineCls } from "../kit";
import { ItemPickerModal } from "../ItemSelect";

/** One sentence with boxes to fill in, e.g. "A customer earns [5] points for every ₹100". */
function Line({ children }: { children: React.ReactNode }) {
  return <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-2 text-[13.5px] text-slate-800">{children}</div>;
}

/** A small number box that sits inside a sentence. */
function NumBox({ value, onChange, step = 1 }: { value: number; onChange: (n: number) => void; step?: number }) {
  return <input type="number" min={0} step={step} className="h-10 w-24 rounded-xl border border-slate-300 bg-white px-3 text-right text-[14px] font-bold text-slate-900 outline-none focus:border-slate-500 focus:ring-4 focus:ring-slate-100" value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))} />;
}

/** A worked example the owner can play with. */
function TryIt({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-xl bg-emerald-50/70 px-3.5 py-3">
      <b className="mb-1.5 block text-[12px] uppercase tracking-[0.1em] text-emerald-800">{title}</b>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-[13.5px] text-slate-800">{children}</div>
    </div>
  );
}

/** A yes/no rule: the switch, what it is about, and in words what it does right now. */
function Rule({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
      <span className="text-[13.5px] text-slate-800">{title}</span>
      <span className="inline-flex items-center gap-2.5">
        <b className={cx("text-[12.5px]", on ? "text-emerald-700" : "text-red-600")}>{on ? "Points allowed" : "Points NOT allowed"}</b>
        <RawSwitch on={on} onChange={onChange} label={title} />
      </span>
    </div>
  );
}

/** A switch with its words next to it (the kit switch only labels itself for screen readers). */
function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-[13px] font-semibold text-slate-700">
      <RawSwitch on={on} onChange={onChange} label={label} />
      {label}
    </span>
  );
}

const note = "text-[12.5px] leading-relaxed text-slate-500";
const small = "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-right text-[13.5px] text-slate-900 outline-none focus:border-slate-400 focus:ring-4 focus:ring-slate-100";

export default function SettingsTab({ d }: { d: LoyaltyState }) {
  // the form starts again from the saved settings whenever they change (after Save)
  return <Form key={JSON.stringify(d.config)} saved={d.config} />;
}

function Form({ saved }: { saved: LoyaltyConfig }) {
  const { s, act } = useAdmin();
  const [c, setC] = useState<LoyaltyConfig>(saved);
  const [reason, setReason] = useState("");
  const [tryEarn, setTryEarn] = useState("500");
  const [tryBill, setTryBill] = useState("300");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(c) !== JSON.stringify(saved);
  const own = s.products.filter((p) => p.loyaltyPoints !== null && p.loyaltyPoints !== undefined).length;
  const cats = [...new Set(s.products.map((p) => p.category))].sort();

  const set = <K extends keyof LoyaltyConfig>(k: K, patch: Partial<LoyaltyConfig[K]>) => setC((x) => ({ ...x, [k]: { ...(x[k] as object), ...patch } as LoyaltyConfig[K] }));
  const warnings = rangeWarnings(c.redeem.ranges, c.redeem.pointValue);
  const crmProblems = crmWarnings(c.crm);
  // the worked examples use the same rules the server uses
  const earnFor100 = (amount: number) => {
    if (!(amount > 0) || amount < c.earn.minBill) return 0;
    const raw = (amount / 100) * c.earn.per100 + 1e-9;
    return c.earn.rounding === "ceil" ? Math.ceil(raw) : c.earn.rounding === "round" ? Math.round(raw) : Math.floor(raw);
  };
  const tryRange = redeemRange(Number(tryBill), c.redeem.ranges);
  const tryMax = tryRange ? Math.min(tryRange.max, Math.floor(Number(tryBill) / c.redeem.pointValue + 1e-9)) : 0;
  const save = async () => {
    setBusy(true);
    await act("loyalty.config", { config: c, reason });
    setBusy(false);
    setReason("");
  };
  const yes = (v: boolean) => (v ? "On" : "Off");
  const exportSettings = () =>
    downloadExcel(`loyalty-settings-${new Date().toISOString().slice(0, 10)}`, [
      {
        name: "Settings",
        rows: [
          ["Setting", "Value"],
          ["Loyalty programme", yes(saved.enabled)],
          ["Points for every ₹100", saved.earn.per100],
          ["Value of 1 point (₹)", saved.redeem.pointValue],
          ["Smallest bill that earns points (₹)", saved.earn.minBill],
          ["Rounding of points", saved.earn.rounding],
          ["Categories that don't earn", saved.earn.excludedCategories.join(", ")],
          ["Items that don't earn", saved.earn.excludedProductIds.map((id) => s.products.find((p) => p.id === id)?.name ?? id).join(", ")],
          ["Using points", yes(saved.redeem.enabled)],
          ["Points with a coupon", yes(saved.redeem.withCoupon)],
          ["Points with a manual discount", yes(saved.redeem.withManual)],
          ["Points with a free gift", yes(saved.redeem.withReward)],
          ["Categories points can't pay for", saved.redeem.excludedCategories.join(", ")],
          ["Items points can't pay for", saved.redeem.excludedProductIds.map((id) => s.products.find((p) => p.id === id)?.name ?? id).join(", ")],
          ["Points gifts", yes(saved.gifts.points)],
          ["Spending rewards", yes(saved.gifts.milestone)],
          ["Bill offers", yes(saved.gifts.offers)],
          ["Spending rewards count every bill ever", yes(saved.gifts.countOldBills)],
          ["Restock free gifts when a bill is voided", yes(saved.gifts.restockOnVoid)],
          ["Unlocked reward valid for (days, 0 = never)", saved.gifts.validityDays],
          ["Points expire after (days, 0 = never)", saved.expiry.days],
          ["Loyalty summary on receipts", yes(saved.display.receiptSummary)],
          ["Consent box starts ticked", yes(saved.display.defaultConsent)],
          ["Tidy deleted bills automatically", yes(saved.display.autoTidy)],
          ["WhatsApp messages", yes(saved.messages.enabled)],
          ...MESSAGE_META.map((m) => [`WhatsApp · ${m.label}`, `${yes(saved.messages.events[m.key])} — ${saved.messages.templates[m.key]}`]),
        ],
      },
      { name: "Points ranges", rows: [["Bill from (₹)", "Up to (₹)", "Minimum points", "Maximum points"], ...saved.redeem.ranges.map((r) => [r.from, r.to ?? "and above", r.min, r.max])] },
      { name: "Customer groups", rows: [["Setting", "Value"], ["New for the first (days)", saved.crm.newDays], ["Regular from (visits)", saved.crm.regularVisits], ["Frequent from (visits)", saved.crm.frequentVisits], ["…counted over (days)", saved.crm.frequentDays], ["High value from (₹)", saved.crm.highValue], ["VIP from (₹)", saved.crm.vipSpend], ["At risk after (days)", saved.crm.atRiskDays], ["Inactive after (days)", saved.crm.inactiveDays], ["Lost after (days)", saved.crm.lostDays]] },
    ]);
  const setRange = (i: number, patch: Partial<RedeemRange>) => set("redeem", { ranges: c.redeem.ranges.map((r, k) => (k === i ? { ...r, ...patch } : r)) });

  return (
    <div className="space-y-5">
      {/* save bar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <Switch on={c.enabled} onChange={(v) => setC({ ...c, enabled: v })} label={c.enabled ? "Loyalty programme is on" : "Loyalty programme is OFF — no points, no loyalty gifts, no bill offers, no messages"} />
        <div className="flex flex-wrap items-center gap-2">
          <input className="h-10 w-64 rounded-xl border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-slate-400" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason for the change (audit log)" />
          <Btn icon="download" onClick={exportSettings}>
            Excel
          </Btn>
          <Btn disabled={!dirty || busy} onClick={() => setC(saved)}>
            Discard
          </Btn>
          <Btn kind="red" disabled={!dirty || busy} onClick={save}>
            {busy ? "Saving…" : "Save settings"}
          </Btn>
        </div>
      </div>

      {/* earning */}
      <Card title="1 · Earning points">
        <p className={cx(note, "mb-4")}>Every time a customer pays a bill, they collect points. Decide how many here.</p>
        <Line>
          A customer earns
          <NumBox value={c.earn.per100} step={0.5} onChange={(n) => set("earn", { per100: n, mode: "per100" })} />
          points for every ₹100 they spend.
        </Line>
        <p className={cx(note, "mb-3 ml-1")}>&ldquo;Spend&rdquo; means the bill amount after discounts — GST and extra charges are not counted. Free gifts, and the part paid with points, never earn points.</p>
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-amber-900">
          <b>Items with their own points.</b> In Inventory you can give an item a fixed number of points (the &ldquo;Loyalty points per item&rdquo; box on the product). {own} of your {s.products.length} items have one. Those items earn <b>exactly that many points each</b> — this ₹100 rule is not used for them, and a discount on the bill does not reduce them. Every other item follows the rule above. The points of all items on a bill are added together.
        </div>
        <Line>
          Bills smaller than ₹
          <NumBox value={c.earn.minBill} onChange={(n) => set("earn", { minBill: n })} />
          earn no points. <span className="text-slate-400">(0 means every bill earns)</span>
        </Line>
        <Line>
          If the points come to a part (like 12.5), they are
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-[13.5px] font-semibold text-slate-800 outline-none focus:border-slate-400" value={c.earn.rounding} onChange={(e) => set("earn", { rounding: e.target.value as LoyaltyConfig["earn"]["rounding"] })} aria-label="Rounding of points">
            <option value="floor">rounded down — 12.5 becomes 12</option>
            <option value="ceil">rounded up — 12.5 becomes 13</option>
          </select>
        </Line>

        <div className="mt-4 rounded-xl border border-slate-100 p-3.5">
          <b className="text-[13px] text-slate-900">Items that earn no points</b>
          <p className={cx(note, "mb-2")}>Leave empty if everything earns points. Pick a whole category, or single items.</p>
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">By category</span>
          <Chips all={cats} picked={c.earn.excludedCategories} onChange={(v) => set("earn", { excludedCategories: v })} none="No category is excluded" />
          <span className="mb-1 mt-3 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Single items</span>
          <ItemPicker products={s.products} picked={c.earn.excludedProductIds} onChange={(v) => set("earn", { excludedProductIds: v })} none="No single item is excluded" />
        </div>

        <TryIt title="Try it — how many points does a bill earn?">
          A bill of ₹
          <NumBox value={Number(tryEarn)} onChange={(n) => setTryEarn(String(n))} />
          earns <b className="text-emerald-700">{earnFor100(Number(tryEarn))} points</b>
          {earnFor100(Number(tryEarn)) > 0 && <>, worth ₹{round2(earnFor100(Number(tryEarn)) * c.redeem.pointValue)} when the customer uses them.</>}
          {Number(tryEarn) > 0 && earnFor100(Number(tryEarn)) === 0 && <> — nothing, because the bill is smaller than ₹{c.earn.minBill}.</>}
        </TryIt>
      </Card>

      {/* redeeming */}
      <Card title="2 · Using points (redeeming)" right={<Switch on={c.redeem.enabled} onChange={(v) => set("redeem", { enabled: v })} label={c.redeem.enabled ? "Customers can use points" : "Using points is off"} />}>
        <p className={cx(note, "mb-4")}>Customers can pay part of a bill with the points they have collected. Decide what a point is worth and how many they may use.</p>
        <Line>
          Each point is worth ₹
          <NumBox value={c.redeem.pointValue} step={0.05} onChange={(n) => set("redeem", { pointValue: Math.max(0.01, n) })} />
          <span className="text-slate-400">— so 100 points = ₹{round2(100 * c.redeem.pointValue)}</span>
        </Line>

        <div className="mt-4 rounded-xl border border-slate-100 p-3.5">
          <b className="text-[13px] text-slate-900">How many points can be used on a bill?</b>
          <p className={cx(note, "mb-3")}>It depends on how big the bill is. Each row says: <i>for a bill from ₹A up to ₹B, the customer must use at least X points and at most Y points.</i> A bill that falls in no row can&apos;t use points.</p>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-[620px] text-[13px]">
              <thead className="bg-slate-50 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Bill is from (₹)</th>
                  <th className="px-3 py-2 text-left">…up to (₹)</th>
                  <th className="px-3 py-2 text-left">Must use at least (points)</th>
                  <th className="px-3 py-2 text-left">Can use at most (points)</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {c.redeem.ranges.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">
                      <input type="number" min={0} className={small} value={r.from} onChange={(e) => setRange(i, { from: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={0} className={small} value={r.to ?? ""} placeholder="and above" onChange={(e) => setRange(i, { to: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={1} className={small} value={r.min} onChange={(e) => setRange(i, { min: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min={1} className={small} value={r.max} onChange={(e) => setRange(i, { max: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Btn size="sm" kind="warn" icon="trash" aria-label="Delete range" onClick={() => set("redeem", { ranges: c.redeem.ranges.filter((_, k) => k !== i) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn size="sm" icon="plus" onClick={() => set("redeem", { ranges: [...c.redeem.ranges, { from: (c.redeem.ranges.at(-1)?.to ?? c.redeem.ranges.at(-1)?.from ?? 0) + 1, to: null, min: 20, max: 40 }] })}>
              Add range
            </Btn>
            <Btn size="sm" onClick={() => set("redeem", { ranges: DEFAULT_CONFIG.redeem.ranges })}>
              Use the suggested ranges
            </Btn>
          </div>
          {warnings.length > 0 && (
            <ul className="mt-3 space-y-1 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-amber-800">
              {warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
          <TryIt title="Try it — what can a customer use on a bill?">
            A bill of ₹
            <NumBox value={Number(tryBill)} onChange={(n) => setTryBill(String(n))} />
            {tryRange ? (
              <>
                — the customer must use at least <b>{tryRange.min}</b> and at most <b>{tryMax}</b> points, which takes <b className="text-emerald-700">₹{round2(tryRange.min * c.redeem.pointValue)} to ₹{round2(tryMax * c.redeem.pointValue)}</b> off (and only if they own that many points).
              </>
            ) : (
              <> — no row covers this amount, so <b className="text-red-600">points can&apos;t be used</b> on it.</>
            )}
          </TryIt>
        </div>

        <div className="mt-4 rounded-xl border border-slate-100 p-3.5">
          <b className="text-[13px] text-slate-900">Can points be used on a bill that also has…</b>
          <p className={cx(note, "mb-2")}>Switch off to stop customers combining points with another saving. If a bill has it, the points are not applied and Billing tells the cashier why.</p>
          <div className="space-y-2.5">
            <Rule on={c.redeem.withCoupon} onChange={(v) => set("redeem", { withCoupon: v })} title="a coupon discount" />
            <Rule on={c.redeem.withManual} onChange={(v) => set("redeem", { withManual: v })} title="a manual discount typed at billing" />
            <Rule on={c.redeem.withReward} onChange={(v) => set("redeem", { withReward: v })} title="a free-gift reward being claimed" />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-slate-100 p-3.5">
          <b className="text-[13px] text-slate-900">Things points can&apos;t be used to pay for</b>
          <p className={cx(note, "mb-2")}>Leave empty if points can pay for anything.</p>
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">By category</span>
          <Chips all={cats} picked={c.redeem.excludedCategories} onChange={(v) => set("redeem", { excludedCategories: v })} none="No category is excluded" />
          <span className="mb-1 mt-3 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">Single items</span>
          <ItemPicker products={s.products} picked={c.redeem.excludedProductIds} onChange={(v) => set("redeem", { excludedProductIds: v })} none="No single item is excluded" />
        </div>
      </Card>

      {/* gifts */}
      <Card title="Free gifts">
        <p className={cx(note, "mb-3")}>Create the gifts themselves in <b>Free Gifts &amp; Rewards</b>. Here you can switch each kind on or off.</p>
        <div className="space-y-3">
          <Switch on={c.gifts.points} onChange={(v) => set("gifts", { points: v })} label="Gifts customers unlock with points" />
          <Switch on={c.gifts.milestone} onChange={(v) => set("gifts", { milestone: v })} label="Gifts for total spending" />
          <Switch on={c.gifts.offers} onChange={(v) => set("gifts", { offers: v })} label="Offers on the bill" />
        </div>
        <div className="mt-4 space-y-2.5 border-t border-slate-100 pt-4">
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.gifts.countOldBills} onChange={(e) => set("gifts", { countOldBills: e.target.checked })} />
            <span>
              <b>Spending rewards count every bill ever paid</b>, not only bills from the day the reward was created. <span className="text-slate-500">Careful: turning this on can unlock gifts for customers right away.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.gifts.restockOnVoid} onChange={(e) => set("gifts", { restockOnVoid: e.target.checked })} />
            <span>
              <b>Put free gifts back in stock when a bill is voided or deleted.</b> <span className="text-slate-500">Off = the gift was already handed over, so only the paid items go back.</span>
            </span>
          </label>
          <Field label="An unlocked spending reward stays valid for (days)" hint="0 = it never expires">
            <input type="number" min={0} className={small} value={c.gifts.validityDays} onChange={(e) => set("gifts", { validityDays: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </Field>
        </div>
      </Card>

      {/* expiry */}
      <Card title="Points expiry">
        <p className={cx(note, "mb-3")}>Leave at 0 if points should never run out. Otherwise points expire this many days after they were earned — the oldest are used first. Customers whose points are about to expire are flagged on their profile.</p>
        <div className="max-w-sm">
          <Field label="Points expire after (days)" hint="0 = never. Applies to points earned from now on.">
            <input type="number" min={0} className={small} value={c.expiry.days} onChange={(e) => set("expiry", { days: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
          </Field>
        </div>
      </Card>

      {/* customer groups */}
      <Card title="Customer groups (CRM)">
        <p className={cx(note, "mb-3")}>Every loyalty customer is put in a group from their paid bills — shown in the Customer CRM tab. These numbers decide where the lines fall.</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="“New” for the first (days)">
            <input type="number" min={1} className={small} value={c.crm.newDays} onChange={(e) => set("crm", { newDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“Regular” from (visits)">
            <input type="number" min={1} className={small} value={c.crm.regularVisits} onChange={(e) => set("crm", { regularVisits: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“Frequent” from (visits)">
            <input type="number" min={1} className={small} value={c.crm.frequentVisits} onChange={(e) => set("crm", { frequentVisits: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="…counted over the last (days)">
            <input type="number" min={1} className={small} value={c.crm.frequentDays} onChange={(e) => set("crm", { frequentDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“High value” from spending (₹)">
            <input type="number" min={0} className={small} value={c.crm.highValue} onChange={(e) => set("crm", { highValue: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="“VIP” from spending (₹)">
            <input type="number" min={0} className={small} value={c.crm.vipSpend} onChange={(e) => set("crm", { vipSpend: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="“At risk” after (days away)">
            <input type="number" min={1} className={small} value={c.crm.atRiskDays} onChange={(e) => set("crm", { atRiskDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“Inactive” after (days away)">
            <input type="number" min={1} className={small} value={c.crm.inactiveDays} onChange={(e) => set("crm", { inactiveDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
          <Field label="“Lost” after (days away)">
            <input type="number" min={1} className={small} value={c.crm.lostDays} onChange={(e) => set("crm", { lostDays: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          </Field>
        </div>
        {crmProblems.length > 0 && (
          <ul className="mt-3 space-y-1 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-amber-800">
            {crmProblems.map((w) => (
              <li key={w}>⚠ {w} <span className="font-normal">They are put in order when you save.</span></li>
            ))}
          </ul>
        )}
      </Card>

      {/* billing and receipts */}
      <Card title="Billing &amp; receipts">
        <div className="space-y-2.5">
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.display.receiptSummary} onChange={(e) => set("display", { receiptSummary: e.target.checked })} />
            <span>
              <b>Print the loyalty summary</b> (previous balance, earned, redeemed, remaining) on receipts and the invoice page for loyalty customers. <span className="text-slate-500">Bills without a loyalty customer never show it.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.display.defaultConsent} onChange={(e) => set("display", { defaultConsent: e.target.checked })} />
            <span>
              <b>Start with &ldquo;agrees to WhatsApp messages&rdquo; ticked</b> when adding a customer. <span className="text-slate-500">Only tick this if you always ask the customer first.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 text-[13px] text-slate-700">
            <input type="checkbox" className="mt-0.5" checked={c.display.autoTidy} onChange={(e) => set("display", { autoTidy: e.target.checked })} />
            <span>
              <b>Tidy up automatically</b> — when this page opens, remove the loyalty records of bills that were deleted.
            </span>
          </label>
        </div>
      </Card>

      {/* whatsapp */}
      <Card title="WhatsApp messages" right={<Switch on={c.messages.enabled} onChange={(v) => set("messages", { enabled: v })} label={c.messages.enabled ? "On" : "Off"} />}>
        <p className={cx(note, "mb-4")}>
          Messages are prepared after each event and kept in the customer&apos;s history — only for customers who agreed to WhatsApp messages. A browser can&apos;t send WhatsApp by itself, so staff tap <b>Send on WhatsApp</b> to open the chat with the message ready. WhatsApp doesn&apos;t report delivery, so they are shown as &ldquo;Opened in WhatsApp&rdquo;, never &ldquo;Sent&rdquo;. Billing is never held up by a message.
        </p>
        {!c.messages.enabled && <p className="mb-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-semibold text-amber-800">All WhatsApp messages are switched off above — the switches below have no effect until you switch them on.</p>}
        <div className="space-y-4">
          {MESSAGE_META.map((m) => (
            <div key={m.key} className="rounded-xl border border-slate-100 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b className="text-[13.5px] text-slate-900">{m.label}</b>
                  <span className="block text-[12px] text-slate-500">{m.when}</span>
                </span>
                <Switch on={c.messages.events[m.key]} onChange={(v) => set("messages", { events: { ...c.messages.events, [m.key]: v } })} label={c.messages.events[m.key] ? "On" : "Off"} />
              </div>
              <textarea
                className={cx(inputLineCls, "mt-2.5 h-24 resize-y py-2.5 leading-relaxed")}
                value={c.messages.templates[m.key]}
                maxLength={600}
                onChange={(e) => set("messages", { templates: { ...c.messages.templates, [m.key]: e.target.value } as Record<MessageKey, string> })}
                aria-label={`${m.label} message`}
              />
              {c.messages.templates[m.key] !== DEFAULT_CONFIG.messages.templates[m.key] && (
                <button type="button" className="mt-1 text-[12px] font-semibold text-red-600 hover:underline" onClick={() => set("messages", { templates: { ...c.messages.templates, [m.key]: DEFAULT_CONFIG.messages.templates[m.key] } as Record<MessageKey, string> })}>
                  Use the standard wording
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-slate-500">
          Words that are filled in for each customer: {MESSAGE_FIELDS.map((f) => `{${f}}`).join("  ")}
        </p>
      </Card>
    </div>
  );
}

/** Pick individual menu items (category first, with search); the chosen ones show as chips that can be removed. */
function ItemPicker({ products, picked, onChange, none }: { products: { id: string; name: string; category: string; price?: number }[]; picked: string[]; onChange: (v: string[]) => void; none: string }) {
  const [open, setOpen] = useState(false);
  const name = (id: string) => products.find((p) => p.id === id)?.name ?? "(removed item)";
  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setOpen(true)} className={cx(inputLineCls, "flex items-center justify-between text-left text-slate-500")} aria-label="Add an item">
        Add an item…
        <span className="text-[12px] text-slate-400">choose a category, then the item</span>
      </button>
      <div className="flex flex-wrap items-center gap-2">
        {picked.map((id) => (
          <button key={id} type="button" onClick={() => onChange(picked.filter((x) => x !== id))} className="h-8 rounded-full border border-red-600 bg-red-600 px-3 text-[12.5px] font-semibold text-white" title="Remove">
            ✕ {name(id)}
          </button>
        ))}
        {!picked.length && <span className="text-[12px] text-slate-400">{none}</span>}
      </div>
      {open && <ItemPickerModal products={products.filter((p) => !picked.includes(p.id))} onClose={() => setOpen(false)} onPick={(id) => (id && onChange([...picked, id]), setOpen(false))} />}
    </div>
  );
}

/** Toggle chips for a list of choices. */
function Chips({ all, picked, onChange, none }: { all: string[]; picked: string[]; onChange: (v: string[]) => void; none: string }) {
  if (!all.length) return <p className="text-[12.5px] text-slate-400">No categories yet.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {all.map((x) => {
        const on = picked.includes(x);
        return (
          <button key={x} type="button" onClick={() => onChange(on ? picked.filter((y) => y !== x) : [...picked, x])} className={cx("h-8 rounded-full border px-3 text-[12.5px] font-semibold transition", on ? "border-red-600 bg-red-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50")}>
            {on ? "✕ " : ""}
            {x}
          </button>
        );
      })}
      {!picked.length && <span className="text-[12px] text-slate-400">{none}</span>}
    </div>
  );
}
