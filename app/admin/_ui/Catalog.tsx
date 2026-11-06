"use client";

import { useMemo, useState } from "react";
import type { Product } from "@/lib/types";
import { rupee } from "@/lib/money";
import { pointsPerUnit } from "@/lib/loyalty/engine";
import { useAdmin } from "./Store";
import { Btn, Icon, Modal, SearchBox, cx } from "./kit";

const thumb = (src: string) => (src.includes("images.unsplash.com") ? src.replace(/([?&])w=\d+/, "$1w=120") : src);

/** Product picker. `onPick` = pick one (billing row); `onAdd` = build a small order (customer tab). */
export default function Catalog({
  open,
  onClose,
  title = "Catalog",
  onPick,
  onAdd,
  addLabel = "Add",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  onPick?: (p: Product) => void;
  onAdd?: (items: { productId: string; qty: number }[]) => Promise<boolean> | boolean;
  addLabel?: string;
}) {
  const { s } = useAdmin();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);

  const close = () => {
    setQ("");
    setCart({});
    onClose();
  };

  const cats = useMemo(() => ["All", ...Array.from(new Set(s.products.map((p) => p.category)))], [s.products]);
  const list = s.products.filter((p) => (cat === "All" || p.category === cat) && (!q || `${p.name} ${p.category}`.toLowerCase().includes(q.toLowerCase())) && (onPick || p.active));
  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = Object.entries(cart).reduce((a, [id, n]) => a + (s.products.find((p) => p.id === id)?.price ?? 0) * n, 0);

  const bump = (p: Product, d: number) =>
    setCart((c) => {
      const n = Math.max(0, Math.min(p.stock ?? 99, (c[p.id] ?? 0) + d));
      const next = { ...c };
      if (n) next[p.id] = n;
      else delete next[p.id];
      return next;
    });

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      wide
      footer={
        onAdd ? (
          <>
            <span className="mr-auto self-center text-[13px] text-slate-500">
              {count} item{count === 1 ? "" : "s"} · <b className="text-slate-900">{rupee(total)}</b>
            </span>
            <Btn onClick={close}>Cancel</Btn>
            <Btn
              kind="red"
              disabled={!count || busy}
              onClick={async () => {
                setBusy(true);
                const ok = await onAdd(Object.entries(cart).map(([productId, qty]) => ({ productId, qty })));
                setBusy(false);
                if (ok) close();
              }}
            >
              {addLabel}
            </Btn>
          </>
        ) : undefined
      }
    >
      <SearchBox value={q} onChange={setQ} placeholder="Search products…" />
      <div className="adm-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
        {cats.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            className={cx("h-8 shrink-0 rounded-full px-3.5 text-[12px] font-semibold transition", cat === c ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
          >
            {c}
          </button>
        ))}
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {list.map((p) => {
          const out = p.stock !== null && p.stock <= 0;
          const n = cart[p.id] ?? 0;
          const pts = pointsPerUnit(p, s.loyaltyEarn);
          return (
            <li key={p.id}>
              <div
                className={cx(
                  "flex items-center gap-3 rounded-2xl border p-2.5 transition",
                  n ? "border-slate-400 bg-slate-50" : "border-slate-100 hover:border-slate-300",
                  out && onAdd && "opacity-50",
                )}
              >
                {p.image ? <img src={thumb(p.image)} alt="" className="h-12 w-12 rounded-xl object-cover" loading="lazy" /> : <span className="grid h-12 w-12 place-items-center rounded-xl bg-slate-100 font-bold text-slate-400">{p.name[0]}</span>}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold text-slate-900">{p.name}</p>
                  <p className="text-[12px] text-slate-500">
                    <b className="text-slate-800">{rupee(p.price)}</b>{pts > 0 && <b className="ml-1.5 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700" title="Loyalty points a member earns">+{pts} pts</b>} · {p.stock === null ? "always available" : out ? <span className="text-red-600">sold out</span> : `${p.stock} in stock`}
                  </p>
                </div>
                {onPick ? (
                  <Btn size="sm" kind="soft" onClick={() => (onPick(p), close())}>
                    Use
                  </Btn>
                ) : n ? (
                  <span className="flex items-center gap-1">
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700" onClick={() => bump(p, -1)} aria-label="Less">
                      <Icon name="minus" size={14} />
                    </button>
                    <b className="w-6 text-center text-[14px]">{n}</b>
                    <button type="button" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 bg-white text-slate-700" onClick={() => bump(p, 1)} aria-label="More" disabled={p.stock !== null && n >= p.stock}>
                      <Icon name="plus" size={14} />
                    </button>
                  </span>
                ) : (
                  <Btn size="sm" kind="soft" disabled={out} onClick={() => bump(p, 1)} icon="plus">
                    Add
                  </Btn>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!list.length && <p className="py-10 text-center text-slate-500">No products match.</p>}
    </Modal>
  );
}
