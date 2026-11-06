"use client";

import { useState } from "react";
import { rupee } from "@/lib/money";
import type { Product } from "@/lib/types";
import type { GiftOffer, LoyaltyState, Reward } from "@/lib/loyalty/types";
import { useAdmin } from "../Store";
import { Badge, Btn, Card, Field, Modal, cx, downloadExcel, inputLineCls } from "../kit";
import { ItemSelect } from "../ItemSelect";

const TXT = "text-[12.5px] text-slate-500";

/** Free Gifts & Rewards: the three kinds of free gift the shop can give. The gift is always an item from the menu, so
    its stock comes off the ordinary inventory — there is no separate gift stock. */
export default function Rewards({ d }: { d: LoyaltyState }) {
  const { s, act, confirm } = useAdmin();
  const [reward, setReward] = useState<{ trigger: "points" | "milestone"; r?: Reward } | null>(null);
  const [offer, setOffer] = useState<{ o?: GiftOffer } | null>(null);
  const nameOf = (id: string | null) => s.products.find((p) => p.id === id)?.name ?? "(removed item)";
  const gifts = d.rewards.filter((r) => r.kind === "free_item");
  const points = gifts.filter((r) => r.trigger === "points");
  const spend = gifts.filter((r) => r.trigger === "milestone");
  const on = d.config.gifts;

  const removeReward = async (r: Reward) => {
    if (!(await confirm({ title: `Remove "${r.name}"?`, body: "Customers can no longer get it. If it has already been unlocked or claimed, it is switched off instead so the history stays.", ok: "Remove", danger: true }))) return;
    await act("loyalty.reward.delete", { id: r.id });
  };
  const removeOffer = async (o: GiftOffer) => {
    if (!(await confirm({ title: `Remove the offer "${o.name}"?`, body: "Bills no longer get this free gift. Bills that already had it are not changed.", ok: "Remove", danger: true }))) return;
    await act("loyalty.offer.delete", { id: o.id });
  };
  const toggleReward = (r: Reward) => act("loyalty.reward.save", { ...r, active: !r.active });
  const toggleOffer = (o: GiftOffer) => act("loyalty.offer.save", { ...o, active: !o.active });

  const exportAll = () =>
    downloadExcel(`free-gifts-and-rewards-${new Date().toISOString().slice(0, 10)}`, [
      { name: "Points gifts", rows: [["Reward", "Gift", "Quantity", "Points needed", "Most per customer", "Most in total", "Claimed so far", "Valid from", "Valid until", "Active"], ...points.map((r) => [r.name, nameOf(r.productId), r.giftQty, r.pointsCost, r.perCustomerLimit ?? "", r.maxRedemptions ?? "", r.redeemed, r.startsOn ?? "", r.endsOn ?? "", r.active ? "Yes" : "No"])] },
      { name: "Spending rewards", rows: [["Reward", "Gift", "Quantity", "Spending that unlocks it (₹)", "Most per customer", "Most in total", "Claimed so far", "Valid from", "Valid until", "Active"], ...spend.map((r) => [r.name, nameOf(r.productId), r.giftQty, r.milestoneAmount, r.perCustomerLimit ?? "", r.maxRedemptions ?? "", r.redeemed, r.startsOn ?? "", r.endsOn ?? "", r.active ? "Yes" : "No"])] },
      { name: "Bill offers", rows: [["Offer", "Applies when", "Minimum bill (₹)", "Item to buy", "Quantity to buy", "Gift", "Gift quantity", "Repeats on one bill", "Who", "Most in total", "Given so far", "Valid from", "Valid until", "Active"], ...d.offers.map((o) => [o.name, o.type === "spend" ? "Bill reaches an amount" : "Customer buys an item", o.minBill, nameOf(o.productId), o.buyQty, nameOf(o.giftProductId), o.giftQty, o.repeatable ? "Yes" : "No", o.audience === "members" ? "Loyalty customers only" : "Everyone", o.maxTotal ?? "", o.given, o.startsOn ?? "", o.endsOn ?? "", o.active ? "Yes" : "No"])] },
    ]);

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Btn icon="download" onClick={exportAll}>
          Excel
        </Btn>
      </div>
      <p className="rounded-xl bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-600">
        A free gift is always an item from your menu. When it is given, it shows on the bill as a <b>FREE GIFT ₹0</b> line and comes off the normal stock — and shows in the Stock movement log.
      </p>

      <Card
        title="1 · Gifts customers unlock with points"
        right={
          <Btn kind="red" size="sm" icon="plus" onClick={() => setReward({ trigger: "points" })}>
            Add gift
          </Btn>
        }
      >
        <p className={cx(TXT, "mb-3")}>For example: 100 points = a free milkshake. It unlocks by itself when the customer has enough points, and the points are used only when the gift is handed over on a paid bill.</p>
        {!on.points && <Off what="points-based gifts" />}
        <List empty="No points-based gifts yet.">
          {points.map((r) => (
            <Row key={r.id} name={r.name} line={`${r.giftQty} × ${nameOf(r.productId)} · ${r.pointsCost} points${r.perCustomerLimit ? ` · max ${r.perCustomerLimit} each` : ""}${r.maxRedemptions ? ` · ${r.redeemed}/${r.maxRedemptions} total` : ""}${r.startsOn || r.endsOn ? ` · ${r.startsOn ?? "…"} to ${r.endsOn ?? "…"}` : ""}`} active={r.active} used={r.redeemed} onEdit={() => setReward({ trigger: "points", r })} onToggle={() => toggleReward(r)} onRemove={() => removeReward(r)} />
          ))}
        </List>
      </Card>

      <Card
        title="2 · Gifts for total spending"
        right={
          <Btn kind="red" size="sm" icon="plus" onClick={() => setReward({ trigger: "milestone" })}>
            Add reward
          </Btn>
        }
      >
        <p className={cx(TXT, "mb-3")}>For example: spend ₹1,000 in total = a free snack. Spending is counted from paid bills only (after discounts, never free gifts), starting from the day you create the reward. It unlocks again each time they pass another multiple.</p>
        {!on.milestone && <Off what="spending rewards" />}
        <List empty="No spending rewards yet.">
          {spend.map((r) => (
            <Row key={r.id} name={r.name} line={`${r.giftQty} × ${nameOf(r.productId)} · every ${rupee(r.milestoneAmount)} spent${r.perCustomerLimit ? ` · max ${r.perCustomerLimit} each` : ""}${r.maxRedemptions ? ` · ${r.redeemed}/${r.maxRedemptions} total` : ""}${r.startsOn || r.endsOn ? ` · ${r.startsOn ?? "…"} to ${r.endsOn ?? "…"}` : ""}`} active={r.active} used={r.redeemed} onEdit={() => setReward({ trigger: "milestone", r })} onToggle={() => toggleReward(r)} onRemove={() => removeReward(r)} />
          ))}
        </List>
      </Card>

      <Card
        title="3 · Offers on the bill (for everyone)"
        right={
          <Btn kind="red" size="sm" icon="plus" onClick={() => setOffer({})}>
            Add offer
          </Btn>
        }
      >
        <p className={cx(TXT, "mb-3")}>For example: spend ₹500 get a free juice, or buy 2 burgers get 1 tea. These work for any customer — they don&apos;t need to be in the loyalty programme. Billing shows the gift when the bill qualifies and staff add it with one tap.</p>
        {!on.offers && <Off what="bill offers" />}
        <List empty="No bill offers yet.">
          {d.offers.map((o) => (
            <Row
              key={o.id}
              name={o.name}
              line={`${o.audience === "members" ? "Loyalty customers only · " : ""}${o.maxTotal ? `${o.given}/${o.maxTotal} given · ` : ""}${o.type === "spend" ? `Bill of ${rupee(o.minBill)} or more${o.productId ? ` with ${o.buyQty} × ${nameOf(o.productId)}` : ""}` : `Buy ${o.buyQty} × ${nameOf(o.productId)}`} → ${o.giftQty} × ${nameOf(o.giftProductId)}${o.repeatable ? " (repeats)" : ""}${o.startsOn || o.endsOn ? ` · ${o.startsOn ?? "…"} to ${o.endsOn ?? "…"}` : ""}`}
              active={o.active}
              onEdit={() => setOffer({ o })}
              onToggle={() => toggleOffer(o)}
              onRemove={() => removeOffer(o)}
            />
          ))}
        </List>
      </Card>

      {reward && <RewardForm trigger={reward.trigger} r={reward.r} products={s.products} onClose={() => setReward(null)} />}
      {offer && <OfferForm o={offer.o} products={s.products} onClose={() => setOffer(null)} />}
    </div>
  );
}

const Off = ({ what }: { what: string }) => <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">Switched off in Settings — {what} are not being given right now.</p>;

function List({ children, empty }: { children: React.ReactNode[]; empty: string }) {
  return children.length ? <ul className="space-y-2">{children}</ul> : <p className="py-4 text-center text-[13px] text-slate-400">{empty}</p>;
}

function Row({ name, line, active, used, onEdit, onToggle, onRemove }: { name: string; line: string; active: boolean; used?: number; onEdit: () => void; onToggle: () => void; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3.5 py-3">
      <span className="min-w-0">
        <b className="text-[14px] text-slate-900">{name}</b> {active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}
        <span className="mt-0.5 block text-[12.5px] text-slate-600">{line}</span>
        {!!used && <span className="text-[11.5px] text-slate-400">Claimed {used} time{used === 1 ? "" : "s"}</span>}
      </span>
      <span className="flex gap-2">
        <Btn size="sm" onClick={onToggle}>
          {active ? "Turn off" : "Turn on"}
        </Btn>
        <Btn size="sm" icon="edit" onClick={onEdit}>
          Edit
        </Btn>
        <Btn size="sm" kind="warn" icon="trash" onClick={onRemove} aria-label="Remove" />
      </span>
    </li>
  );
}

function ProductSelect({ value, onChange, products, none }: { value: string; onChange: (v: string) => void; products: Product[]; none?: string }) {
  const list = products.filter((p) => p.active || p.id === value);
  // category first, then the item — with a search box
  return <ItemSelect products={list} value={value} onChange={onChange} none={none} clear={none} />;
}

function RewardForm({ trigger, r, products, onClose }: { trigger: "points" | "milestone"; r?: Reward; products: Product[]; onClose: () => void }) {
  const { act } = useAdmin();
  const [f, setF] = useState({ name: r?.name ?? "", productId: r?.productId ?? "", giftQty: String(r?.giftQty ?? 1), pointsCost: r ? String(r.pointsCost) : "", milestoneAmount: r ? String(r.milestoneAmount) : "", description: r?.description ?? "", startsOn: r?.startsOn ?? "", endsOn: r?.endsOn ?? "", perCustomerLimit: r?.perCustomerLimit ? String(r.perCustomerLimit) : "", maxRedemptions: r?.maxRedemptions ? String(r.maxRedemptions) : "", active: r?.active ?? true });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const x = await act("loyalty.reward.save", { id: r?.id, trigger, ...f });
    setBusy(false);
    if (x.ok) onClose();
  };
  const ok = f.name.trim() && f.productId && Number(f.giftQty) >= 1 && (trigger === "points" ? Number(f.pointsCost) >= 1 : Number(f.milestoneAmount) > 0);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${r ? "Edit" : "Add"} ${trigger === "points" ? "a points gift" : "a spending reward"}`}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="red" disabled={busy || !ok} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Reward name">
          <input className={inputLineCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={trigger === "points" ? "Free Oreo Milkshake" : "Free snack"} autoFocus />
        </Field>
        <Field label="Free gift (from your menu)">
          <ProductSelect value={f.productId} onChange={(v) => setF({ ...f, productId: v })} products={products} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Gift quantity">
            <input className={inputLineCls} inputMode="numeric" value={f.giftQty} onChange={(e) => setF({ ...f, giftQty: e.target.value.replace(/\D/g, "") })} />
          </Field>
          {trigger === "points" ? (
            <Field label="Points needed">
              <input className={inputLineCls} inputMode="numeric" value={f.pointsCost} onChange={(e) => setF({ ...f, pointsCost: e.target.value.replace(/\D/g, "") })} placeholder="100" />
            </Field>
          ) : (
            <Field label="Spending that unlocks it (₹)" hint="Total paid purchases">
              <input className={inputLineCls} inputMode="decimal" value={f.milestoneAmount} onChange={(e) => setF({ ...f, milestoneAmount: e.target.value.replace(/[^\d.]/g, "") })} placeholder="1000" />
            </Field>
          )}
        </div>
        <Field label="Description (optional)">
          <input className={inputLineCls} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Valid from (optional)">
            <input className={inputLineCls} type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
          </Field>
          <Field label="Valid until (optional)">
            <input className={inputLineCls} type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
          </Field>
          <Field label="Most times one customer can get it" hint="Blank = no limit">
            <input className={inputLineCls} inputMode="numeric" value={f.perCustomerLimit} onChange={(e) => setF({ ...f, perCustomerLimit: e.target.value.replace(/\D/g, "") })} />
          </Field>
          <Field label="Most times in total" hint="Blank = no limit">
            <input className={inputLineCls} inputMode="numeric" value={f.maxRedemptions} onChange={(e) => setF({ ...f, maxRedemptions: e.target.value.replace(/\D/g, "") })} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
      </div>
    </Modal>
  );
}

function OfferForm({ o, products, onClose }: { o?: GiftOffer; products: Product[]; onClose: () => void }) {
  const { act } = useAdmin();
  const [f, setF] = useState({
    name: o?.name ?? "",
    type: (o?.type ?? "spend") as "spend" | "buy",
    minBill: o ? String(o.minBill || "") : "",
    productId: o?.productId ?? "",
    buyQty: String(o?.buyQty ?? 1),
    giftProductId: o?.giftProductId ?? "",
    giftQty: String(o?.giftQty ?? 1),
    startsOn: o?.startsOn ?? "",
    endsOn: o?.endsOn ?? "",
    repeatable: o?.repeatable ?? false,
    audience: (o?.audience ?? "all") as "all" | "members",
    maxTotal: o?.maxTotal ? String(o.maxTotal) : "",
    active: o?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const x = await act("loyalty.offer.save", { id: o?.id, ...f });
    setBusy(false);
    if (x.ok) onClose();
  };
  const ok = f.name.trim() && f.giftProductId && Number(f.giftQty) >= 1 && (f.type === "spend" ? Number(f.minBill) > 0 : f.productId && Number(f.buyQty) >= 1);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${o ? "Edit" : "Add"} a bill offer`}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="red" disabled={busy || !ok} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </Btn>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Offer name">
          <input className={inputLineCls} value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Spend ₹500, get a free juice" autoFocus />
        </Field>
        <Field label="When does it apply?">
          <div className="flex rounded-xl bg-slate-100 p-1">
            {(
              [
                ["spend", "The bill reaches an amount"],
                ["buy", "Customer buys an item"],
              ] as const
            ).map(([v, t]) => (
              <button key={v} type="button" onClick={() => setF({ ...f, type: v })} className={cx("h-9 flex-1 rounded-lg text-[12.5px] font-bold transition", f.type === v ? "bg-white text-slate-900 shadow" : "text-slate-500")}>
                {t}
              </button>
            ))}
          </div>
        </Field>
        {f.type === "spend" ? (
          <>
            <Field label="Minimum bill amount (₹)" hint="Counted after any coupon or discount, before GST.">
              <input className={inputLineCls} inputMode="decimal" value={f.minBill} onChange={(e) => setF({ ...f, minBill: e.target.value.replace(/[^\d.]/g, "") })} placeholder="500" />
            </Field>
            <Field label="Only if they also buy (optional)">
              <ProductSelect value={f.productId} onChange={(v) => setF({ ...f, productId: v })} products={products} none="Any items" />
            </Field>
          </>
        ) : (
          <Field label="The customer buys">
            <div className="grid grid-cols-[96px_1fr] gap-2">
              <input className={inputLineCls} inputMode="numeric" value={f.buyQty} onChange={(e) => setF({ ...f, buyQty: e.target.value.replace(/\D/g, "") })} aria-label="How many" />
              <ProductSelect value={f.productId} onChange={(v) => setF({ ...f, productId: v })} products={products} />
            </div>
          </Field>
        )}
        <Field label="Free gift (from your menu)">
          <div className="grid grid-cols-[96px_1fr] gap-2">
            <input className={inputLineCls} inputMode="numeric" value={f.giftQty} onChange={(e) => setF({ ...f, giftQty: e.target.value.replace(/\D/g, "") })} aria-label="Gift quantity" />
            <ProductSelect value={f.giftProductId} onChange={(v) => setF({ ...f, giftProductId: v })} products={products} />
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts (optional)">
            <input className={inputLineCls} type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
          </Field>
          <Field label="Ends (optional)">
            <input className={inputLineCls} type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who can get it">
            <select className={inputLineCls} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as "all" | "members" })}>
              <option value="all">Every customer</option>
              <option value="members">Loyalty customers only</option>
            </select>
          </Field>
          <Field label="Most times in total" hint="Blank = no limit">
            <input className={inputLineCls} inputMode="numeric" value={f.maxTotal} onChange={(e) => setF({ ...f, maxTotal: e.target.value.replace(/\D/g, "") })} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-[13px] text-slate-700">
          <input type="checkbox" className="mt-0.5" checked={f.repeatable} onChange={(e) => setF({ ...f, repeatable: e.target.checked })} />
          <span>
            Give the gift again for every multiple on one bill <span className="text-slate-500">(e.g. a ₹1,000 bill earns two gifts from a ₹500 offer). Off = at most once per bill.</span>
          </span>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
      </div>
    </Modal>
  );
}
