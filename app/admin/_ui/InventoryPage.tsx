"use client";

import { useMemo, useRef, useState } from "react";
import type { AdminState, Product } from "@/lib/types";
import { pointsPerUnit } from "@/lib/loyalty/engine";
import { rupee } from "@/lib/money";
import { useAdmin } from "./Store";
import { Badge, Btn, Empty, Field, Icon, Kpi, Modal, Page, PageHead, SearchBox, Switch, cx, inputCls, downloadExcel } from "./kit";

const IMAGE_MAX_BYTES = 4 * 1024 * 1024; // 4 MB per image, as agreed with the client.
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const fileToDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("read failed"));
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsDataURL(f);
  });

type Form = {
  id?: string;
  name: string;
  category: string;
  price: string;
  track: boolean;
  stock: string;
  lowAt: string;
  /** loyalty points one unit earns; blank = the shop-wide rule (admin only) */
  loyaltyPoints: string;
  description: string;
  image: string;
  tags: string[];
  active: boolean;
};

const EMPTY: Form = { name: "", category: "", price: "", track: true, stock: "10", lowAt: "4", loyaltyPoints: "", description: "", image: "", tags: [], active: true };
const TAGS = [
  ["bestseller", "★ Bestseller"],
  ["new", "New"],
] as const;
const thumb = (src: string) => (src.includes("images.unsplash.com") ? src.replace(/([?&])w=\d+/, "$1w=120") : src);

const th = "px-4 py-3.5 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap";
const td = "px-4 py-3 text-[13px]";

/* Table-ish list of products — shown inside a KPI tile's modal when the user
   taps "Low stock", "Sold out" or "On the menu" to see what's behind the number. */
function ProductSummaryList({ products, empty, showStock, showStatus }: { products: Product[]; empty: string; showStock?: boolean; showStatus?: boolean }) {
  if (!products.length) return <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-[13px] text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
      {products.map((p) => (
        <li key={p.id} className="flex items-center gap-3 bg-white px-3 py-2.5">
          {p.image ? <img src={thumb(p.image)} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" loading="lazy" /> : <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 font-bold text-slate-400">{p.name[0]}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold text-slate-900">{p.name}</p>
            <p className="truncate text-[11.5px] text-slate-500">{p.category} · {rupee(p.price)}</p>
          </div>
          <div className="shrink-0 text-right text-[12px]">
            {showStock && (
              <span className={cx("adm-num font-bold", p.stock === 0 ? "text-red-600" : p.stock !== null && p.stock <= p.lowAt ? "text-amber-600" : "text-slate-700")}>
                {p.stock === null ? "∞" : p.stock} {p.stock !== null && "left"}
              </span>
            )}
            {showStatus && (p.active ? <Badge tone="green">On menu</Badge> : <Badge tone="slate">Hidden</Badge>)}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* Per-product contribution to total stock value, biggest first — explains what
   makes up the Stock Value KPI. */
function StockValueBreakdown({ products }: { products: Product[] }) {
  const rows = products
    .filter((p) => p.stock !== null && p.stock > 0)
    .map((p) => ({ p, value: p.price * (p.stock ?? 0) }))
    .sort((a, b) => b.value - a.value);
  if (!rows.length) return <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-[13px] text-slate-500">Nothing is tracked yet — turn on stock tracking on a product to see its value here.</p>;
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
      {rows.map(({ p, value }) => (
        <li key={p.id} className="bg-white px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-semibold text-slate-900">{p.name}</span>
            <b className="adm-num shrink-0 text-slate-900">{rupee(value)}</b>
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11.5px] text-slate-500">
            <span className="shrink-0">{p.stock}× {rupee(p.price)}</span>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="adm-fill h-full rounded-full bg-sky-500" style={{ width: `${(value / total) * 100}%` }} />
            </div>
            <span className="shrink-0 text-slate-400">{Math.round((value / total) * 100)}%</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* Image chooser: one photo per product. Takes a file (up to 4 MB) and stores it
   as a base64 data URL on the product, or accepts a pasted link. The × button
   clears it. Everything stays on `form.image`, which both the form preview and
   the catalog already know how to render. */
function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { toast } = useAdmin();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pickFile = async (f: File | null | undefined) => {
    if (!f) return;
    if (!IMAGE_TYPES.includes(f.type)) {
      toast({ kind: "err", title: "That file type is not supported.", body: "Use JPEG, PNG, WebP or GIF." });
      return;
    }
    if (f.size > IMAGE_MAX_BYTES) {
      toast({ kind: "err", title: "That image is too big.", body: `Keep it under 4 MB — this one is ${(f.size / 1024 / 1024).toFixed(1)} MB.` });
      return;
    }
    setBusy(true);
    try {
      onChange(await fileToDataUrl(f));
    } catch {
      toast({ kind: "err", title: "Couldn't read that image." });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = ""; // let the same file be picked again after delete
    }
  };

  const uploaded = value.startsWith("data:");

  return (
    <div className="space-y-2">
      <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
      <div className="flex flex-wrap items-center gap-2">
        <Btn size="sm" kind="soft" icon="download" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? "Reading…" : value ? "Replace image" : "Upload image"}
        </Btn>
        {value && (
          <Btn size="sm" kind="red" icon="trash" onClick={() => onChange("")}>
            Remove
          </Btn>
        )}
        <span className="text-[11.5px] text-slate-400">One image · up to 4 MB</span>
      </div>
      <input
        className={inputCls}
        value={uploaded ? "" : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={uploaded ? "Uploaded image in use — clear it to paste a link" : "or paste an image URL (https://…)"}
        disabled={uploaded}
      />
    </div>
  );
}

type StockFilter = "all" | "menu" | "hidden" | "low" | "out";

/* What the screen should show the instant a stock button is pressed; the server
   confirms (and corrects, if it has to) in the background. */
const withStock = (id: string, next: (now: number) => number) => (st: AdminState): AdminState => ({
  ...st,
  products: st.products.map((p) => (p.id === id && p.stock !== null ? { ...p, stock: Math.max(0, next(p.stock)) } : p)),
});
const stepBy = (id: string, delta: number) => ({ optimistic: withStock(id, (n) => n + delta) });

function StockCell({ p }: { p: Product }) {
  const { act } = useAdmin();
  const [edit, setEdit] = useState<string | null>(null);
  if (p.stock === null)
    return (
      <span className="inline-flex items-center gap-2 text-slate-400">
        ∞ <span className="text-[11px]">untracked</span>
      </span>
    );
  const tone = p.stock <= 0 ? "text-red-600" : p.stock <= p.lowAt ? "text-amber-600" : "text-slate-900";
  const commit = () => {
    if (edit !== null && edit.trim() !== "" && Number(edit) !== p.stock) act("product.stock", { id: p.id, set: Number(edit) }, { optimistic: withStock(p.id, () => Number(edit)) });
    setEdit(null);
  };
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40" onClick={() => act("product.stock", { id: p.id, delta: -1 }, stepBy(p.id, -1))} disabled={p.stock <= 0} aria-label={`One less ${p.name}`}>
        <Icon name="minus" size={13} />
      </button>
      {edit !== null ? (
        <input
          autoFocus
          className="h-7 w-14 rounded-lg border border-slate-400 text-center text-[13px] font-bold outline-none"
          value={edit}
          inputMode="numeric"
          onChange={(e) => setEdit(e.target.value.replace(/\D/g, ""))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEdit(null);
          }}
        />
      ) : (
        <button type="button" title="Click to set exact stock" className={cx("h-7 min-w-14 rounded-lg px-2 text-center text-[14px] font-extrabold hover:bg-slate-100", tone)} onClick={() => setEdit(String(p.stock))}>
          {p.stock}
        </button>
      )}
      <button type="button" className="grid h-7 w-7 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50" onClick={() => act("product.stock", { id: p.id, delta: 1 }, stepBy(p.id, 1))} aria-label={`One more ${p.name}`}>
        <Icon name="plus" size={13} />
      </button>
    </span>
  );
}

export default function InventoryPage() {
  const { s, act, confirm, toast, role } = useAdmin();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [catEdit, setCatEdit] = useState<{ mode: "new" | "rename"; name: string } | null>(null);
  const [manageCats, setManageCats] = useState(false);
  /* "Manage stock": type the new count for any products, then save them all at once */
  const [bulk, setBulk] = useState<Record<string, string> | null>(null);
  const [bulkQ, setBulkQ] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [renameOf, setRenameOf] = useState<string | null>(null);
  const [renaming, setRenaming] = useState("");
  const [move, setMove] = useState<{ p: Product; dir: "added" | "removed"; qty: string; note: string } | null>(null);

  /* categories in use, plus ones added from Manage categories that have no products yet */
  const cats = useMemo(() => Array.from(new Set([...s.products.map((p) => p.category), ...s.categories.map((c) => c.name)])), [s.products, s.categories]);
  const [newCat, setNewCat] = useState("");
  const low = s.products.filter((p) => p.stock !== null && p.stock > 0 && p.stock <= p.lowAt);
  const out = s.products.filter((p) => p.stock !== null && p.stock <= 0);
  const value = s.products.reduce((a, p) => a + (p.stock && p.stock > 0 ? p.stock * p.price : 0), 0);

  const list = s.products.filter((p) => {
    if (cat !== "All" && p.category !== cat) return false;
    if (q && !`${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === "menu") return p.active;
    if (filter === "hidden") return !p.active;
    if (filter === "low") return p.stock !== null && p.stock > 0 && p.stock <= p.lowAt;
    if (filter === "out") return p.stock !== null && p.stock <= 0;
    return true;
  });

  const open = (p?: Product) => {
    setCatEdit(null);
    openForm(p);
  };
  const openForm = (p?: Product) =>
    setForm(
      p
        ? {
            id: p.id,
            name: p.name,
            category: p.category,
            price: String(p.price),
            track: p.stock !== null,
            stock: p.stock === null ? "10" : String(p.stock),
            lowAt: String(p.lowAt),
            loyaltyPoints: p.loyaltyPoints === null ? "" : String(p.loyaltyPoints),
            description: p.description,
            image: p.image,
            tags: p.tags,
            active: p.active,
          }
        : { ...EMPTY, category: cat !== "All" ? cat : cats[0] ?? "" },
    );

  const applyCat = () => {
    if (!catEdit || !form) return;
    const name = catEdit.name.trim();
    if (!name) return;
    setForm({ ...form, category: name });
    setCatEdit(null);
  };

  const exportProducts = () =>
    downloadExcel(`inventory-${new Date().toISOString().slice(0, 10)}.xlsx`, [
      {
        name: "Products",
        rows: [
          ["Name", "Category", "Price", "Stock", "Low-stock alert at", "Status", "Loyalty points / item", "On menu", "Description"],
          ...s.products.map((p) => [p.name, p.category, p.price, p.stock === null ? "Not tracked" : p.stock, p.stock === null ? "" : p.lowAt, p.stock === null ? "Always available" : p.stock <= 0 ? "Sold out" : p.stock <= p.lowAt ? "Low" : "In stock", p.loyaltyPoints === null ? "Automatic" : p.loyaltyPoints, p.active ? "Yes" : "No", p.description]),
        ],
      },
    ]);

  const bulkChanges = bulk
    ? s.products.flatMap((p) => {
        const raw = bulk[p.id];
        if (raw === undefined || raw.trim() === "") return [];
        const v = Math.floor(Number(raw));
        return Number.isFinite(v) && v >= 0 && v !== p.stock ? [{ p, v }] : [];
      })
    : [];
  const saveBulk = async () => {
    setBulkBusy(true);
    let done = 0;
    for (const { p, v } of bulkChanges) {
      // each product's number is set outright; the screen updates at once and the server is re-read after the last one
      const r = await act("product.stock", { id: p.id, set: v, note: "Bulk stock update" }, { optimistic: withStock(p.id, () => v) });
      if (!r.ok) break;
      done++;
    }
    setBulkBusy(false);
    toast({ kind: done === bulkChanges.length ? "ok" : "err", title: done === bulkChanges.length ? `Stock updated for ${done} product${done === 1 ? "" : "s"}` : `Updated ${done} of ${bulkChanges.length} — the rest weren't saved` });
    if (done === bulkChanges.length) setBulk(null);
  };

  const addCategory = async () => {
    const name = newCat.trim();
    if (!name) return;
    const r = await act("category.add", { name });
    if (r.ok) {
      setNewCat("");
      toast({ kind: "ok", title: `${name} added` });
    }
  };

  const renameCat = async (from: string) => {
    const to = renaming.trim();
    setRenaming("");
    setRenameOf(null);
    if (!to || to === from) return;
    const r = await act("category.rename", { from, to });
    if (r.ok) {
      toast({ kind: "ok", title: `Renamed to ${to}` });
      if (cat === from) setCat(to);
    }
  };

  const moveQty = Math.floor(Number(move?.qty) || 0);
  const moveBad = !move || moveQty <= 0 || (move.dir === "removed" && moveQty > (move.p.stock ?? 0));
  /* The modal closes and the number changes at once; if the server refuses, the form
     comes back with what was typed. */
  const saveMove = async () => {
    if (!move || moveBad) return;
    const m = move;
    const delta = m.dir === "added" ? moveQty : -moveQty;
    setMove(null);
    const r = await act("product.stock", { id: m.p.id, delta, move: m.dir, note: m.note }, stepBy(m.p.id, delta));
    if (r.ok) toast({ kind: "ok", title: `${m.dir === "added" ? "Added" : "Removed"} ${Math.abs(delta)} ${m.dir === "added" ? "to" : "from"} ${m.p.name}` });
    else setMove(m);
  };

  const save = async () => {
    if (!form) return;
    setBusy(true);
    const r = await act<Product>("product.save", { ...form, stock: form.track ? form.stock : null });
    setBusy(false);
    if (r.ok) {
      if (!r.pending) toast({ kind: "ok", title: form.id ? `${r.result.name} saved` : `${r.result.name} added${r.result.active ? " to the menu" : ""}` });
      setForm(null);
    }
  };

  return (
    <Page>
      <PageHead
        title="Inventory"
        sub="Only products that are on the menu show up on the guest menu."
        right={
          <span className="flex flex-wrap gap-2">
            <Btn icon="box" onClick={() => (setBulk({}), setBulkQ(""))} disabled={!s.products.length}>
              Manage stock
            </Btn>
            <Btn icon="download" onClick={exportProducts} disabled={!s.products.length}>
              Download Excel
            </Btn>
            <Btn icon="edit" onClick={() => setManageCats(true)}>
              Manage categories
            </Btn>
            <Btn kind="red" icon="plus" onClick={() => open()}>
              Add product
            </Btn>
          </span>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi
          label="On the menu"
          value={`${s.products.filter((p) => p.active).length} / ${s.products.length}`}
          hint="Visible to guests"
          icon="box"
          tone="emerald"
          details={<ProductSummaryList products={s.products} empty="No products yet." showStatus />}
        />
        <Kpi
          label="Low stock"
          value={low.length}
          hint="At or below alert level"
          icon="alert"
          tone={low.length ? "amber" : "slate"}
          details={<ProductSummaryList products={low} empty="Nothing is running low — stock levels look healthy." showStock />}
        />
        <Kpi
          label="Sold out"
          value={out.length}
          hint="Shown as sold out"
          icon="x"
          tone={out.length ? "red" : "slate"}
          details={<ProductSummaryList products={out} empty="Nothing is sold out right now." showStock />}
        />
        <Kpi
          label="Stock value"
          value={rupee(value)}
          hint="Tracked stock at menu price"
          icon="rupee"
          tone="sky"
          details={<StockValueBreakdown products={s.products} />}
        />
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="adm-scroll flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
          {["All", ...cats].map((c) => {
            const n = c === "All" ? s.products.length : s.products.filter((p) => p.category === c).length;
            const on = cat === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                className={cx(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-[12.5px] font-semibold transition",
                  on
                    ? "border-slate-900 bg-slate-900 text-white shadow-[0_4px_14px_-6px_rgba(15,23,42,.6)]"
                    : "border-transparent bg-slate-100 text-slate-600 hover:border-slate-200 hover:bg-slate-50",
                )}
              >
                <span className="truncate">{c}</span>
                <span className={cx("adm-num rounded-full px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums", on ? "bg-white/15 text-white/90" : "bg-white text-slate-500")}>{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          <select className="h-11 rounded-full border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-700 outline-none focus:border-slate-400" value={filter} onChange={(e) => setFilter(e.target.value as StockFilter)} aria-label="Filter">
            <option value="all">All products</option>
            <option value="menu">On the menu</option>
            <option value="hidden">Hidden</option>
            <option value="low">Low stock</option>
            <option value="out">Sold out</option>
          </select>
          <SearchBox value={q} onChange={setQ} placeholder="Search products…" className="w-full sm:w-64" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-100 shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)]">
        <div className="adm-scroll overflow-x-auto">
          <table className="w-full min-w-[860px]">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Category</th>
                <th className={th}>Price</th>
                <th className={th}>Stock</th>
                <th className={th}>On menu</th>
                <th className={cx(th, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className={cx("border-b border-slate-100 last:border-0 hover:bg-slate-50/50", !p.active && "opacity-60")}>
                  <td className={td}>
                    <div className="flex items-center gap-3">
                      {p.image ? <img src={thumb(p.image)} alt="" className="h-11 w-11 rounded-xl object-cover" loading="lazy" /> : <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 font-bold text-slate-400">{p.name[0]}</span>}
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 font-semibold text-slate-900">
                          {p.name}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-1">
                          {p.tags.map((t) => (
                            <Badge key={t} tone={t === "bestseller" ? "amber" : "violet"}>
                              {t}
                            </Badge>
                          ))}
                          {p.stock !== null && p.stock <= 0 ? <Badge tone="red">Sold out</Badge> : p.stock !== null && p.stock <= p.lowAt ? <Badge tone="amber">Low</Badge> : null}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className={cx(td, "text-slate-600")}>{p.category}</td>
                  <td className={cx(td, "font-bold text-slate-900")}>{rupee(p.price)}</td>
                  <td className={td}>
                    <StockCell p={p} />
                  </td>
                  <td className={td}>
                    <Switch on={p.active} onChange={() => act("product.toggle", { id: p.id })} label={`${p.name} on the menu`} />
                  </td>
                  <td className={cx(td, "text-right")}>
                    <span className="inline-flex gap-1">
                      {p.stock !== null && (
                        <Btn size="sm" kind="plain" icon="box" onClick={() => setMove({ p, dir: "added", qty: "", note: "" })}>
                          Stock in/out
                        </Btn>
                      )}
                      <Btn size="sm" kind="plain" icon="edit" onClick={() => open(p)}>
                        Edit
                      </Btn>
                      {role === "admin" && (
                      <Btn
                        size="sm"
                        kind="plain"
                        className="text-red-600 hover:bg-red-50"
                        onClick={async () => {
                          if (await confirm({ title: `Delete ${p.name}?`, body: "It disappears from the menu and catalog, and its stock movement history is deleted too. Past orders and bills keep their copy of what was sold. To hide it for a while, switch “On menu” off instead.", ok: "Delete", danger: true }))
                            act("product.delete", { id: p.id });
                        }}
                        aria-label={`Delete ${p.name}`}
                      >
                        <Icon name="trash" size={14} />
                      </Btn>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && (
            <Empty icon="box" title={s.products.length ? "No products match" : "Your inventory is empty"}>
              {s.products.length ? "Try another filter." : "Add products — they appear on the guest menu straight away."}
            </Empty>
          )}
        </div>
      </div>

      <Modal
        open={!!move}
        onClose={() => setMove(null)}
        title={move ? `Stock in / out · ${move.p.name}` : ""}
        footer={
          <>
            <Btn onClick={() => setMove(null)}>Cancel</Btn>
            <Btn kind="red" disabled={moveBad} onClick={saveMove}>
              {move?.dir === "removed" ? "Remove stock" : "Add stock"}
            </Btn>
          </>
        }
      >
        {move && (
          <div className="space-y-4">
            <p className="text-[13px] text-slate-500">
              In stock now: <b className="text-slate-900">{move.p.stock}</b> · every change is written to the Stock movement timeline.
            </p>
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
              {(
                [
                  ["added", "Add stock"],
                  ["removed", "Remove stock"],
                ] as const
              ).map(([d, t]) => (
                <button key={d} type="button" onClick={() => setMove({ ...move, dir: d })} className={cx("h-9 flex-1 rounded-lg text-[13px] font-bold transition", move.dir === d ? "bg-white text-slate-900 shadow" : "text-slate-500")}>
                  {t}
                </button>
              ))}
            </div>
            <Field label="Quantity">
              <input className={inputCls} type="number" min={1} autoFocus inputMode="numeric" value={move.qty} onChange={(e) => setMove({ ...move, qty: e.target.value })} placeholder="e.g. 24" />
            </Field>
            {move.dir === "removed" && moveQty > (move.p.stock ?? 0) && <p className="text-[12.5px] font-semibold text-red-600">Only {move.p.stock} in stock.</p>}
            <Field label={move.dir === "added" ? "Note (supplier, invoice…)" : "Reason (wastage, damaged, own use…)"}>
              <input className={inputCls} maxLength={120} value={move.note} onChange={(e) => setMove({ ...move, note: e.target.value })} placeholder={move.dir === "added" ? "Fresh batch from the kitchen" : "Dropped / expired"} />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={bulk !== null}
        onClose={() => !bulkBusy && setBulk(null)}
        wide
        title="Manage stock"
        footer={
          <>
            <span className="mr-auto self-center text-[13px] text-slate-500">{bulkChanges.length ? `${bulkChanges.length} change${bulkChanges.length === 1 ? "" : "s"} to save` : "Type a new count for any product"}</span>
            <Btn disabled={bulkBusy} onClick={() => setBulk(null)}>
              Cancel
            </Btn>
            <Btn kind="red" disabled={bulkBusy || !bulkChanges.length} onClick={saveBulk}>
              {bulkBusy ? "Saving…" : `Save ${bulkChanges.length || ""} change${bulkChanges.length === 1 ? "" : "s"}`}
            </Btn>
          </>
        }
      >
        <div className="space-y-3">
          <SearchBox value={bulkQ} onChange={setBulkQ} placeholder="Find a product…" />
          <p className="text-[12px] text-slate-500">Type the count you now have. Leave a row empty to keep it. Products that aren&apos;t tracked start being tracked when you give them a number. Every change goes into the stock movement log.</p>
          <div className="adm-scroll max-h-[420px] overflow-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead className="sticky top-0 bg-slate-50 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Product</th>
                  <th className="px-3 py-2 text-right">Now</th>
                  <th className="px-3 py-2 text-right">New count</th>
                  <th className="px-3 py-2 text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {s.products
                  .filter((p) => !bulkQ || `${p.name} ${p.category}`.toLowerCase().includes(bulkQ.toLowerCase()))
                  .map((p) => {
                    const raw = bulk?.[p.id] ?? "";
                    const v = Math.floor(Number(raw));
                    const has = raw.trim() !== "" && Number.isFinite(v) && v >= 0;
                    const diff = has && p.stock !== null ? v - p.stock : null;
                    return (
                      <tr key={p.id} className={cx("border-t border-slate-100", has && v !== p.stock && "bg-amber-50/50")}>
                        <td className="px-3 py-2">
                          <b className="block text-slate-900">{p.name}</b>
                          <span className="text-[11.5px] text-slate-500">{p.category}</span>
                        </td>
                        <td className={cx("adm-num px-3 py-2 text-right font-semibold", p.stock !== null && p.stock <= 0 ? "text-red-600" : p.stock !== null && p.stock <= p.lowAt ? "text-amber-600" : "text-slate-700")}>{p.stock === null ? <span className="text-slate-400">Not tracked</span> : p.stock}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            className={cx(inputCls, "ml-auto h-9 w-24 text-right")}
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            value={raw}
                            placeholder={p.stock === null ? "Track…" : String(p.stock)}
                            onChange={(e) => setBulk({ ...(bulk ?? {}), [p.id]: e.target.value })}
                            aria-label={`New stock for ${p.name}`}
                          />
                        </td>
                        <td className={cx("adm-num px-3 py-2 text-right font-bold", diff === null ? "text-slate-300" : diff > 0 ? "text-emerald-700" : diff < 0 ? "text-red-600" : "text-slate-400")}>{diff === null ? (has && p.stock === null ? "tracking on" : "—") : diff > 0 ? `+${diff}` : diff}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <Modal open={manageCats} onClose={() => setManageCats(false)} title="Manage categories" footer={<Btn onClick={() => setManageCats(false)}>Done</Btn>}>
        <div className="mb-3 flex gap-2">
          <input className={inputCls} value={newCat} maxLength={40} placeholder="New category, e.g. Shakes" onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCategory()} />
          <Btn kind="red" icon="plus" disabled={!newCat.trim()} onClick={addCategory}>
            Add
          </Btn>
        </div>
        <ul className="grid gap-2">
          {cats.map((c) => (
            <li key={c} className="flex items-center gap-3 rounded-xl border border-slate-100 px-4 py-2.5">
              {renameOf === c ? (
                <>
                  <input className={inputCls} autoFocus value={renaming} maxLength={40} onChange={(e) => setRenaming(e.target.value)} onKeyDown={(e) => e.key === "Enter" && renameCat(c)} />
                  <Btn size="sm" kind="red" disabled={!renaming.trim()} onClick={() => renameCat(c)}>
                    Save
                  </Btn>
                  <Btn size="sm" onClick={() => setRenameOf(null)}>
                    Cancel
                  </Btn>
                </>
              ) : (
                <>
                  <span className="flex-1 font-semibold text-slate-800">{c}</span>
                  <span className="text-[12px] text-slate-500">{s.products.filter((p) => p.category === c).length} items</span>
                  <Btn
                    size="sm"
                    kind="plain"
                    icon="edit"
                    onClick={() => {
                      setRenameOf(c);
                      setRenaming(c);
                    }}
                  >
                    Rename
                  </Btn>
                  {role === "admin" && !s.products.some((p) => p.category === c) && (
                    <Btn size="sm" kind="plain" className="text-red-600" onClick={() => act("category.delete", { name: c })}>
                      Remove
                    </Btn>
                  )}
                </>
              )}
            </li>
          ))}
          {!cats.length && <p className="text-[13px] text-slate-500">No categories yet — add one above.</p>}
        </ul>
      </Modal>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? "Edit product" : "Add product"}
        wide
        footer={
          <>
            <Btn onClick={() => setForm(null)}>Cancel</Btn>
            <Btn kind="red" disabled={busy || !form?.name.trim() || form?.price === ""} onClick={save}>
              {form?.id ? "Save product" : "Add product"}
            </Btn>
          </>
        }
      >
        {form && (
          <div className="grid gap-5 md:grid-cols-[1fr_220px]">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name *" className="sm:col-span-2">
                <input className={inputCls} value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Crispy Veg Burger" />
              </Field>
              <Field label="Category *">
                <select className={inputCls} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {!form.category && <option value="">Select category…</option>}
                  {(form.category && !cats.includes(form.category) ? [...cats, form.category] : cats).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {catEdit ? (
                  <div className="mt-2 flex gap-2">
                    <input className={inputCls} autoFocus value={catEdit.name} maxLength={40} onChange={(e) => setCatEdit({ ...catEdit, name: e.target.value })} placeholder={catEdit.mode === "new" ? "New category name" : "Rename category"} />
                    <Btn size="sm" kind="red" disabled={!catEdit.name.trim()} onClick={applyCat}>
                      OK
                    </Btn>
                    <Btn size="sm" onClick={() => setCatEdit(null)}>
                      Cancel
                    </Btn>
                  </div>
                ) : (
                  <div className="mt-1.5 flex gap-3 text-[12px] font-semibold text-sky-700">
                    <button type="button" onClick={() => setCatEdit({ mode: "new", name: "" })}>
                      + New
                    </button>
                  </div>
                )}
              </Field>
              <Field label="Price (₹) *">
                <input className={inputCls} type="number" min={0} step="0.5" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="140" />
              </Field>
              <div className="rounded-2xl border border-slate-100 p-4 sm:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <span>
                    <b className="block text-[13px] text-slate-800">Track stock</b>
                    <span className="text-[12px] text-slate-500">Off for made-to-order items like coffee — they never sell out.</span>
                  </span>
                  <Switch on={form.track} onChange={(v) => setForm({ ...form, track: v })} label="Track stock" />
                </div>
                {form.track && (
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <Field label="In stock now">
                      <input className={inputCls} type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} />
                    </Field>
                    <Field label="Low-stock alert at">
                      <input className={inputCls} type="number" min={0} value={form.lowAt} onChange={(e) => setForm({ ...form, lowAt: e.target.value })} />
                    </Field>
                  </div>
                )}
              </div>
              {role === "admin" ? (
                <Field
                  label="Loyalty points per item"
                  className="sm:col-span-2"
                  hint={`Points one ${form.name || "item"} earns a member. Leave blank for the automatic rule${form.price ? ` (currently ${pointsPerUnit({ id: form.id ?? "", category: form.category, price: Number(form.price) || 0, loyaltyPoints: null }, s.loyaltyEarn)} pts)` : ""}. Customers see this on the menu.`}
                >
                  <input className={inputCls} type="number" min={0} step={1} inputMode="numeric" placeholder={form.price ? `Automatic (${pointsPerUnit({ id: form.id ?? "", category: form.category, price: Number(form.price) || 0, loyaltyPoints: null }, s.loyaltyEarn)})` : "Automatic"} value={form.loyaltyPoints} onChange={(e) => setForm({ ...form, loyaltyPoints: e.target.value })} />
                </Field>
              ) : (
                <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-[12.5px] text-slate-500 sm:col-span-2">Loyalty points for this item are set by the admin.</p>
              )}
              <Field label="Description" className="sm:col-span-2">
                <textarea className={cx(inputCls, "h-20 resize-none py-3")} maxLength={240} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="One line that makes it irresistible." />
              </Field>
              <Field label="Image" className="sm:col-span-2" hint="Upload one photo (JPEG, PNG, WebP or GIF, up to 4 MB) or paste a link.">
                <ImageField value={form.image} onChange={(v) => setForm({ ...form, image: v })} />
              </Field>
            </div>
            <div className="space-y-4">
              <div className="aspect-square overflow-hidden rounded-2xl bg-slate-100">
                {form.image ? <img src={form.image} alt="" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-[12px] text-slate-400">No image</span>}
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 text-[13px] font-semibold text-slate-700">
                Show on menu
                <Switch on={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Show on menu" />
              </label>
              <div className="flex flex-wrap gap-2">
                {TAGS.map(([t, label]) => {
                  const on = form.tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, tags: on ? form.tags.filter((x) => x !== t) : [...form.tags, t] })}
                      className={cx("h-8 rounded-full px-3 text-[12px] font-bold transition", on ? "bg-amber-400 text-amber-950" : "bg-slate-100 text-slate-500")}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}
