"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { INGREDIENT_UNITS, type Batch, type Ingredient, type IngredientUnit, type Product, type Recipe } from "@/lib/types";
import { rupee } from "@/lib/money";
import { useAdmin } from "./Store";
import { Badge, Btn, Card, Empty, Field, Icon, Kpi, Modal, Page, PageHead, SearchBox, cx, downloadExcel, inputCls } from "./kit";

/* ============================================================
   RAW-INGREDIENT INVENTORY
   The shop's wet / dry stores — sugar in grams, milk in millilitres —
   plus the batch log that pulls from them and the waste meter that
   watches what gets thrown out. Everything flows into one ledger
   the admin can filter and download as Excel-friendly CSV.
   ============================================================ */

const UNIT_LABEL = Object.fromEntries(INGREDIENT_UNITS.map((u) => [u.key, u.key])) as Record<IngredientUnit, string>;

const num3 = (n: number) => Math.round(n * 1000) / 1000;
const fmtQty = (n: number, unit: IngredientUnit) => `${num3(n).toLocaleString("en-IN", { maximumFractionDigits: 3 })}${unit}`;
const perUnitRupee = (n: number) => `₹${(Math.round(n * 10000) / 10000).toLocaleString("en-IN", { maximumFractionDigits: 4 })}`;

const th = "px-4 py-3 text-left text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500 whitespace-nowrap";
const td = "px-4 py-3 text-[13px]";

/* ---------------- add / edit ingredient ---------------- */
type IngForm = { id?: string; name: string; unit: IngredientUnit; lowAt: string };
const EMPTY_ING: IngForm = { name: "", unit: "g", lowAt: "0" };

function IngredientModal({ initial, onClose }: { initial: IngForm; onClose: () => void }) {
  const { act, toast } = useAdmin();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) return toast({ kind: "err", title: "Name is required." });
    setBusy(true);
    const r = await act("ingredient.save", { id: f.id, name: f.name, unit: f.unit, lowAt: Number(f.lowAt) || 0 });
    setBusy(false);
    if (r.ok) {
      if (!r.pending) toast({ kind: "ok", title: f.id ? "Ingredient updated." : "Ingredient added." });
      onClose();
    }
  };
  return (
    <Modal open onClose={onClose} title={f.id ? "Edit ingredient" : "New ingredient"} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="dark" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Btn></>}>
      <div className="space-y-4">
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sugar, Milk, Flour…" autoFocus /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Measured in">
            <select className={inputCls} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value as IngredientUnit })}>
              {INGREDIENT_UNITS.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Low-stock warning (${f.unit})`} hint="Flagged in the list when stock falls to or below this.">
            <input className={inputCls} inputMode="decimal" value={f.lowAt} onChange={(e) => setF({ ...f, lowAt: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 500" />
          </Field>
        </div>
        {!f.id && <p className="rounded-xl bg-slate-50 px-4 py-3 text-[12.5px] text-slate-500">After saving, use <b>Add stock</b> to record a purchase — the system works out the per-{f.unit} price from the quantity and total cost.</p>}
      </div>
    </Modal>
  );
}

/* ---------------- add stock (purchase) / waste / adjust modal ---------------- */
type MoveKind = "purchase" | "waste" | "adjust";
function MoveModal({ ing, kind, onClose }: { ing: Ingredient; kind: MoveKind; onClose: () => void }) {
  const { act, toast } = useAdmin();
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [stock, setStock] = useState(String(ing.stock));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const title = kind === "purchase" ? "Add stock" : kind === "waste" ? "Log waste" : "Correct stock";
  const label = kind === "purchase" ? `Quantity bought (${ing.unit})` : kind === "waste" ? `Quantity wasted (${ing.unit})` : `Actual stock on hand (${ing.unit})`;
  const perUnit = kind === "purchase" && Number(qty) > 0 && Number(cost) >= 0 ? perUnitRupee(Number(cost) / Number(qty)) : "";
  const submit = async () => {
    setBusy(true);
    const op = kind === "purchase" ? "ingredient.purchase" : kind === "waste" ? "ingredient.waste" : "ingredient.adjust";
    const payload: Record<string, unknown> = { id: ing.id, note };
    if (kind === "purchase") { payload.qty = Number(qty); payload.cost = Number(cost); }
    else if (kind === "waste") payload.qty = Number(qty);
    else payload.stock = Number(stock);
    const r = await act(op, payload);
    setBusy(false);
    if (r.ok) {
      toast({ kind: "ok", title: kind === "purchase" ? `Added ${qty}${ing.unit} of ${ing.name}.` : kind === "waste" ? `Logged ${qty}${ing.unit} wasted.` : `${ing.name} stock set to ${stock}${ing.unit}.` });
      onClose();
    }
  };
  const ok = kind === "adjust" ? Number(stock) >= 0 : Number(qty) > 0 && (kind !== "purchase" || Number(cost) >= 0);
  return (
    <Modal open onClose={onClose} title={`${title} · ${ing.name}`} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind={kind === "waste" ? "red" : "dark"} onClick={submit} disabled={!ok || busy}>{busy ? "Saving…" : title}</Btn></>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-[12.5px] text-slate-500">
          On hand now: <b className="adm-num text-slate-900">{fmtQty(ing.stock, ing.unit)}</b> · running cost {perUnitRupee(ing.costPerUnit)}/{ing.unit}
        </div>
        {kind !== "adjust" ? (
          <Field label={label}><input className={inputCls} inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 1000" /></Field>
        ) : (
          <Field label={label}><input className={inputCls} inputMode="decimal" autoFocus value={stock} onChange={(e) => setStock(e.target.value.replace(/[^\d.]/g, ""))} /></Field>
        )}
        {kind === "purchase" && (
          <>
            <Field label="Total cost (₹)"><input className={inputCls} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 85" /></Field>
            {perUnit && <p className="rounded-xl bg-emerald-50 px-4 py-2.5 text-[12.5px] font-semibold text-emerald-700">That works out to {perUnit}/{ing.unit}. Weighted into the running cost.</p>}
          </>
        )}
        <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "waste" ? "Spilled, expired, trimmed off…" : kind === "purchase" ? "Invoice #, supplier, batch…" : "Why the correction?"} maxLength={200} /></Field>
      </div>
    </Modal>
  );
}

/* ---------------- the "log a batch" quick form ---------------- */
/* A row can carry a raw ingredient (consumed) or an inventory product (produced).
   Empty rows wait for the item picker; `kind` becomes "ing" or "prod" once set. */
type Row = { key: number; kind: "ing" | "prod" | ""; itemId: string; qty: string; note: string };
let rowSeq = 0;
const blankRow = (): Row => ({ key: ++rowSeq, kind: "", itemId: "", qty: "", note: "" });

/* ---------- item picker (search + sort + ingredients/products tabs) ---------- */
type PickKind = "all" | "ing" | "prod";
type SortKey = "name" | "stock" | "price";

function ItemPicker({ ingredients: ings, products, initialKind = "all", onPick, onClose }: {
  ingredients: Ingredient[]; products: Product[]; initialKind?: PickKind;
  onPick: (choice: { kind: "ing" | "prod"; id: string }) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<PickKind>(initialKind);
  const [sort, setSort] = useState<SortKey>("name");

  const needle = q.trim().toLowerCase();
  const ingRows = useMemo(() => {
    let arr = ings.filter((i) => !needle || i.name.toLowerCase().includes(needle));
    if (sort === "name") arr = [...arr].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "stock") arr = [...arr].sort((a, b) => b.stock - a.stock);
    else /* price */ arr = [...arr].sort((a, b) => a.costPerUnit - b.costPerUnit);
    return arr;
  }, [ings, needle, sort]);

  const prodRows = useMemo(() => {
    let arr = products.filter((p) => p.active !== false && (!needle || p.name.toLowerCase().includes(needle)));
    if (sort === "name") arr = [...arr].sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "stock") arr = [...arr].sort((a, b) => (b.stock ?? -1) - (a.stock ?? -1));
    else /* price */ arr = [...arr].sort((a, b) => a.price - b.price);
    return arr;
  }, [products, needle, sort]);

  const empty = (kind === "ing" ? ingRows.length : kind === "prod" ? prodRows.length : ingRows.length + prodRows.length) === 0;

  const tab = (v: PickKind, label: string, count: number) => (
    <button
      key={v}
      type="button"
      onClick={() => setKind(v)}
      className={cx("h-9 rounded-xl px-3.5 text-[12px] font-extrabold uppercase tracking-wide transition", kind === v ? "bg-white text-slate-900 shadow" : "text-slate-500 hover:text-slate-800")}
    >
      {label} <span className="adm-num ml-1 text-slate-400">{count}</span>
    </button>
  );

  const ingRow = (i: Ingredient) => (
    <button
      key={`ing-${i.id}`} type="button"
      onClick={() => { onPick({ kind: "ing", id: i.id }); onClose(); }}
      className="group flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700"><Icon name="orders" size={16} /></span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] text-slate-900">{i.name}</b>
        <span className="text-[11.5px] text-slate-500">Raw ingredient · {perUnitRupee(i.costPerUnit)}/{i.unit}</span>
      </span>
      <span className="adm-num shrink-0 text-right text-[12.5px] font-bold text-slate-700">{fmtQty(i.stock, i.unit)} <span className="font-normal text-slate-400">left</span></span>
    </button>
  );

  const prodRow = (p: Product) => (
    <button
      key={`prod-${p.id}`} type="button"
      onClick={() => { onPick({ kind: "prod", id: p.id }); onClose(); }}
      className="group flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 text-left transition hover:border-slate-300 hover:bg-slate-50"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Icon name="box" size={16} /></span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] text-slate-900">{p.name}</b>
        <span className="text-[11.5px] text-slate-500">Inventory · {rupee(p.price)}{p.category ? ` · ${p.category}` : ""}</span>
      </span>
      <span className="adm-num shrink-0 text-right text-[12.5px] font-bold text-slate-700">{p.stock === null ? "untracked" : `${p.stock} in stock`}</span>
    </button>
  );

  return (
    <Modal
      open wide onClose={onClose}
      title={<span className="flex items-center gap-2.5"><Icon name="box" size={18} className="text-red-600" /> Pick an item</span>}
      footer={<Btn onClick={onClose}>Cancel</Btn>}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1">
            <SearchBox value={q} onChange={setQ} placeholder="Search ingredients or inventory…" />
          </div>
          <select
            className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 outline-none focus:border-slate-400"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort by"
          >
            <option value="name">Sort: Name (A–Z)</option>
            <option value="stock">Sort: Stock (high → low)</option>
            <option value="price">Sort: Price (low → high)</option>
          </select>
        </div>
        <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
          {tab("all", "All", ingRows.length + prodRows.length)}
          {tab("ing", "Ingredients", ingRows.length)}
          {tab("prod", "Inventory", prodRows.length)}
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {empty && <Empty icon="box" title="Nothing matched">Try a different search.</Empty>}
          {kind !== "prod" && ingRows.length > 0 && (
            <>
              {kind === "all" && <div className="pt-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Raw ingredients</div>}
              {ingRows.map(ingRow)}
            </>
          )}
          {kind !== "ing" && prodRows.length > 0 && (
            <>
              {kind === "all" && <div className="pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Inventory items</div>}
              {prodRows.map(prodRow)}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function BatchModal({ ingredients: ings, products, recipes, onClose }: { ingredients: Ingredient[]; products: Product[]; recipes: Recipe[]; onClose: () => void }) {
  const { act, confirm, toast, role } = useAdmin();
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [busy, setBusy] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [recipeOpen, setRecipeOpen] = useState(false);
  const recipeBoxRef = useRef<HTMLDivElement>(null);
  /* Close the recipe dropdown on a click outside it. Using a listener (not a
     fullscreen backdrop) keeps the modal's own × close button clickable while
     the dropdown is open. */
  useEffect(() => {
    if (!recipeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!recipeBoxRef.current?.contains(e.target as Node)) setRecipeOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [recipeOpen]);
  const [saveRecipe, setSaveRecipe] = useState(false);
  const [pickFor, setPickFor] = useState<number | null>(null); // row key the picker opens for
  const ingById = useMemo(() => new Map(ings.map((i) => [i.id, i])), [ings]);
  const prodById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const recipeById = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes]);
  const selectedRecipe = recipeId ? recipeById.get(recipeId) : null;

  const setRow = (k: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === k ? { ...x, ...patch } : x)));
  const add = () => setRows((r) => [...r, blankRow()]);
  const del = (k: number) => setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== k) : [blankRow()]));

  const loadRecipe = (rid: string) => {
    setRecipeId(rid);
    setRecipeOpen(false);
    if (!rid) return;
    const r = recipeById.get(rid);
    if (!r) return;
    /* Only ingredients that still exist get filled; a removed one is dropped
       quietly rather than showing an unresolvable row. */
    const filled: Row[] = r.items
      .filter((it) => ingById.has(it.ingredientId))
      .map((it) => ({ key: ++rowSeq, kind: "ing" as const, itemId: it.ingredientId, qty: String(it.qty), note: it.note }));
    setRows(filled.length ? filled : [blankRow()]);
    /* The batch name becomes the recipe name — this is what shows in the ledger
       as "Used in <name>", which the client wants to be the recipe's own name. */
    setName(r.name);
    if (r.note) setNote(r.note);
  };

  const clearRecipe = () => {
    setRecipeId("");
    setRecipeOpen(false);
  };

  const removeRecipe = async (rid: string) => {
    const r = recipeById.get(rid);
    if (!r) return;
    const ok = await confirm({ title: `Remove recipe "${r.name}"?`, body: "The recipe disappears from the picker. Past batches logged with it stay in the ledger.", ok: "Remove", danger: true });
    if (!ok) return;
    const res = await act("recipe.delete", { id: r.id });
    if (res.ok) {
      toast({ kind: "ok", title: `Recipe "${r.name}" removed.` });
      if (recipeId === rid) setRecipeId("");
    }
  };

  /* Split rows into what the batch USED (ingredients) and what it PRODUCED (inventory). */
  const uses = rows
    .filter((r) => r.kind === "ing" && r.itemId)
    .map((r) => ({ r, ing: ingById.get(r.itemId)!, qty: Number(r.qty) || 0 }))
    .filter((u) => u.ing && u.qty > 0);
  const produces = rows
    .filter((r) => r.kind === "prod" && r.itemId)
    .map((r) => ({ r, prod: prodById.get(r.itemId)!, qty: Math.floor(Number(r.qty) || 0) }))
    .filter((p) => p.prod && p.qty > 0);
  const total = uses.reduce((s, u) => s + u.qty * u.ing.costPerUnit, 0);
  const problems = uses.filter((u) => u.qty > u.ing.stock);

  const save = async () => {
    if (!name.trim()) return toast({ kind: "err", title: "Give the batch a name." });
    if (!uses.length && !produces.length) return toast({ kind: "err", title: "Add at least one ingredient or inventory item." });
    if (problems.length) return toast({ kind: "err", title: `Not enough ${problems[0].ing.name} on hand.` });
    setBusy(true);
    const r = await act<Batch>("batch.save", {
      name, note,
      uses: uses.map((u) => ({ ingredientId: u.ing.id, qty: u.qty, note: u.r.note })),
      produces: produces.map((p) => ({ productId: p.prod.id, qty: p.qty, note: p.r.note })),
    });
    if (!r.ok) { setBusy(false); return; }
    if (saveRecipe && uses.length) {
      /* The user asked us to remember these rows for next time. Recipes still
         only hold the ingredient side — produced items are logged ad-hoc. */
      const items = uses.map((u) => ({ ingredientId: u.ing.id, qty: u.qty, note: u.r.note }));
      await act("recipe.save", { name, note, items });
    }
    setBusy(false);
    const madeMsg = produces.length ? ` · made ${produces.reduce((s, p) => s + p.qty, 0)} inventory unit${produces.reduce((s, p) => s + p.qty, 0) === 1 ? "" : "s"}` : "";
    toast({ kind: "ok", title: `Batch "${r.result.name}" logged — ${rupee(r.result.totalCost)} in ingredients${madeMsg}.`, body: saveRecipe ? "Saved as a recipe for next time." : undefined });
    onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={<span className="flex items-center gap-2.5"><Icon name="orders" size={18} className="text-red-600" /> Log a batch</span>}
      footer={
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-slate-600">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-slate-900" checked={saveRecipe} onChange={(e) => setSaveRecipe(e.target.checked)} />
            Save as a recipe for next time
          </label>
          <div className="flex items-center gap-2">
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn kind="dark" onClick={save} disabled={busy || !uses.length}>{busy ? "Logging…" : `Log batch · ${rupee(total)}`}</Btn>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {(
          <Field label="Repeat a saved recipe" hint="Picking one fills the rows below and names the batch — still editable before you log it.">
            <div className="relative" ref={recipeBoxRef}>
              <div className="flex h-10 w-full items-center rounded-xl border border-slate-300 bg-white pr-1 text-left text-[14px] outline-none transition focus-within:border-slate-500 hover:border-slate-400">
                <button
                  type="button"
                  onClick={() => setRecipeOpen((v) => !v)}
                  className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-l-xl px-3 text-left"
                  aria-haspopup="listbox"
                  aria-expanded={recipeOpen}
                >
                  <span className="min-w-0 flex-1 truncate font-semibold text-slate-800">
                    {selectedRecipe ? (
                      <>
                        {selectedRecipe.name}
                        <span className="ml-1.5 font-normal text-slate-500">({selectedRecipe.items.length} ingredient{selectedRecipe.items.length === 1 ? "" : "s"})</span>
                      </>
                    ) : (
                      <span className="text-slate-400">Pick a recipe…</span>
                    )}
                  </span>
                  <Icon name="chevron" size={14} className={cx("shrink-0 text-slate-400 transition-transform", recipeOpen ? "-rotate-90" : "rotate-90")} />
                </button>
                {selectedRecipe && (
                  <button
                    type="button"
                    onClick={clearRecipe}
                    className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Clear selection"
                    title="Clear selection"
                  >
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
              {recipeOpen && (
                <div role="listbox" className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-[0_10px_24px_-10px_rgba(15,23,42,.25)]">
                    {recipes.length === 0 && <p className="px-3 py-3 text-[13px] text-slate-500">No saved recipes yet — tick &ldquo;Save as a recipe for next time&rdquo; when you log a batch.</p>}
                    {recipes.map((r) => (
                      <div key={r.id} className={cx("flex items-center gap-1 px-1", r.id === recipeId && "bg-slate-50")}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={r.id === recipeId}
                          onClick={() => loadRecipe(r.id)}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-slate-100"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-800">{r.name}</span>
                          <span className="shrink-0 text-[11.5px] text-slate-500">{r.items.length} ingredient{r.items.length === 1 ? "" : "s"}</span>
                        </button>
                        {role === "admin" && (
                        <button
                          type="button"
                          onClick={() => removeRecipe(r.id)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove recipe ${r.name}`}
                          title={`Remove "${r.name}" from the picker`}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </Field>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
          <Field label="Batch name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chocolate cake × 2" maxLength={120} autoFocus /></Field>
          <Field label="Note (optional)"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Any details to remember" maxLength={300} /></Field>
        </div>
        <div className="space-y-2 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
          {rows.map((r) => {
            const ing = r.kind === "ing" ? ingById.get(r.itemId) : undefined;
            const prod = r.kind === "prod" ? prodById.get(r.itemId) : undefined;
            const q = Number(r.qty) || 0;
            const over = ing && q > ing.stock;
            const cost = ing && q > 0 ? q * ing.costPerUnit : 0;
            const unit = ing?.unit ?? (prod ? "pc" : "");
            return (
              <div key={r.key} className="flex flex-wrap items-center gap-2 border-b border-slate-200/70 pb-2 last:border-0 last:pb-0">
                <button
                  type="button"
                  onClick={() => setPickFor(r.key)}
                  className="flex h-10 min-w-[200px] flex-1 items-center gap-2.5 rounded-xl border border-slate-300 bg-white px-3 text-left text-[14px] outline-none transition hover:border-slate-400"
                  aria-label="Pick item"
                >
                  {ing ? (
                    <>
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-700"><Icon name="orders" size={13} /></span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{ing.name}</span>
                      <span className="shrink-0 rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">Used</span>
                      <span className="adm-num shrink-0 text-[11.5px] text-slate-500">{fmtQty(ing.stock, ing.unit)} left</span>
                    </>
                  ) : prod ? (
                    <>
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700"><Icon name="box" size={13} /></span>
                      <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{prod.name}</span>
                      <span className="shrink-0 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Produced</span>
                      <span className="adm-num shrink-0 text-[11.5px] text-slate-500">{prod.stock === null ? "untracked" : `${prod.stock} in stock`}</span>
                    </>
                  ) : (
                    <span className="flex-1 text-slate-400">Pick an item…</span>
                  )}
                  <Icon name="chevron" size={14} className="shrink-0 rotate-90 text-slate-400" />
                </button>
                <div className="relative">
                  <input type="number" min={0} step={r.kind === "prod" ? 1 : 0.001} inputMode="decimal" className={cx("h-10 w-28 rounded-xl border bg-white pl-3 pr-10 text-[14px] outline-none", over ? "border-red-400 focus:border-red-500" : "border-slate-300 focus:border-slate-400")} placeholder="Qty" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} aria-label="Quantity" />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">{unit}</span>
                </div>
                <input className="h-10 min-w-[140px] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-[13px] outline-none placeholder:text-slate-400 focus:border-slate-400" placeholder="Note (optional)" value={r.note} onChange={(e) => setRow(r.key, { note: e.target.value })} aria-label="Line note" maxLength={160} />
                <span className="adm-num w-[88px] shrink-0 text-right text-[13px] font-bold">{cost > 0 ? rupee(cost) : "—"}</span>
                <button type="button" onClick={() => del(r.key)} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900" aria-label="Remove row"><Icon name="trash" size={16} /></button>
              </div>
            );
          })}
        </div>
        <Btn size="sm" kind="soft" onClick={add}>+ Add item</Btn>
        <p className="rounded-xl bg-slate-50 px-4 py-2.5 text-[12px] text-slate-500">
          Raw ingredients come out of stock when the batch is logged. Inventory items go in — one line per item in the ledger. Costed at the current ₹/unit.
        </p>
      </div>
      {pickFor !== null && (
        <ItemPicker
          ingredients={ings}
          products={products}
          onPick={(choice) => setRow(pickFor, { kind: choice.kind, itemId: choice.id, qty: "" })}
          onClose={() => setPickFor(null)}
        />
      )}
    </Modal>
  );
}

/* ---------------- the main page ---------------- */
export default function IngredientsPage() {
  const { s, act, confirm, toast, role } = useAdmin();
  const [edit, setEdit] = useState<IngForm | null>(null);
  const [move, setMove] = useState<{ ing: Ingredient; kind: MoveKind } | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [q, setQ] = useState("");

  const ings = useMemo(() => s.ingredients ?? [], [s.ingredients]);
  const active = useMemo(() => ings.filter((i) => i.active), [ings]);
  const low = active.filter((i) => i.lowAt > 0 && i.stock <= i.lowAt);
  const stockValue = active.reduce((sum, i) => sum + i.stock * i.costPerUnit, 0);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return active;
    return active.filter((i) => i.name.toLowerCase().includes(t));
  }, [active, q]);

  const removeIng = async (ing: Ingredient) => {
    const ok = await confirm({ title: `Remove ${ing.name}?`, body: "Past movements stay in the ledger. You can always re-add the ingredient with the same name.", ok: "Remove", danger: true });
    if (!ok) return;
    const r = await act("ingredient.delete", { id: ing.id });
    if (r.ok) toast({ kind: "ok", title: `${ing.name} removed.` });
  };

  return (
    <Page>
      <PageHead
        title="Ingredients & waste"
        sub="Raw stores (sugar, milk, flour…) by weight or volume. Log purchases, record batches, flag waste."
        right={
          <>
            <Link href="/admin/inventory/ingredient-moves" className="inline-flex h-9 items-center gap-2 rounded-xl bg-slate-100 px-3.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-200">
              <Icon name="list" size={16} /> Movements log
            </Link>
            <Btn kind="soft" icon="download" disabled={!ings.length} onClick={() => downloadExcel(`ingredients-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: "Ingredients", rows: [["Ingredient", "Unit", "In stock", "Low-stock warning", "Cost per unit", "Stock value", "Status"], ...ings.filter((i) => i.active).map((i) => [i.name, i.unit, i.stock, i.lowAt, i.costPerUnit, Math.round(i.stock * i.costPerUnit * 100) / 100, i.stock <= 0 ? "Out" : i.lowAt > 0 && i.stock <= i.lowAt ? "Low" : "OK"])] }])}>Excel</Btn>
            <Btn kind="soft" icon="plus" onClick={() => setEdit(EMPTY_ING)}>New ingredient</Btn>
            <Btn kind="dark" icon="orders" onClick={() => setBatchOpen(true)} disabled={active.length === 0} title={active.length === 0 ? "Add an ingredient first" : "Log a batch"}>Log a batch</Btn>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Active ingredients" value={active.length} icon="box" tone="emerald" />
        <Kpi label="Low on stock" value={low.length} icon="alert" tone={low.length ? "amber" : "slate"} />
        <Kpi label="Stock value" value={rupee(stockValue)} icon="rupee" tone="sky" />
      </div>

      <div className="mt-5">
        {/* ---------- ingredients catalog ---------- */}
        <Card title={<span className="flex items-center gap-2.5"><Icon name="box" size={18} className="text-red-600" /> Ingredients</span>} right={<SearchBox value={q} onChange={setQ} placeholder="Find an ingredient…" className="w-full max-w-[220px]" />}>
          {filtered.length === 0 ? (
            <Empty icon="box" title={ings.length ? "No matches." : "No ingredients yet."}>Add sugar, milk, flour and the rest the kitchen measures.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead className="bg-slate-50/60">
                  <tr>
                    <th className={th}>Ingredient</th>
                    <th className={cx(th, "text-right")}>On hand</th>
                    <th className={cx(th, "text-right")}>Cost / unit</th>
                    <th className={cx(th, "text-right")}>Stock value</th>
                    <th className={cx(th, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((i) => {
                    const lowFlag = i.lowAt > 0 && i.stock <= i.lowAt;
                    return (
                      <tr key={i.id} className="border-t border-slate-100">
                        <td className={td}>
                          <b className="block text-[13.5px] text-slate-900">
                            {i.name}
                            {s.approvals.some((x) => x.status === "pending" && x.targetId === i.id) && <Badge tone="amber" className="ml-2">Awaiting admin</Badge>}
                          </b>
                          <span className="text-[11.5px] text-slate-500">Measured in {UNIT_LABEL[i.unit]}{i.lowAt > 0 ? ` · warn at ${fmtQty(i.lowAt, i.unit)}` : ""}</span>
                        </td>
                        <td className={cx(td, "text-right")}>
                          <span className={cx("adm-num font-bold", i.stock <= 0 ? "text-red-600" : lowFlag ? "text-amber-600" : "text-slate-900")}>{fmtQty(i.stock, i.unit)}</span>
                          {lowFlag && <Badge tone="amber" className="ml-2">Low</Badge>}
                        </td>
                        <td className={cx(td, "text-right adm-num")}>{i.costPerUnit > 0 ? `${perUnitRupee(i.costPerUnit)} / ${i.unit}` : <span className="text-slate-400">—</span>}</td>
                        <td className={cx(td, "text-right adm-num font-semibold")}>{rupee(i.stock * i.costPerUnit)}</td>
                        <td className={cx(td, "text-right whitespace-nowrap")}>
                          <Btn size="sm" kind="soft" onClick={() => setMove({ ing: i, kind: "purchase" })}>+ Stock</Btn>{" "}
                          <Btn size="sm" kind="soft" onClick={() => setMove({ ing: i, kind: "waste" })}>Waste</Btn>{" "}
                          <Btn size="sm" onClick={() => setMove({ ing: i, kind: "adjust" })}>Adjust</Btn>{" "}
                          <Btn size="sm" onClick={() => setEdit({ id: i.id, name: i.name, unit: i.unit, lowAt: String(i.lowAt) })}>Edit</Btn>{" "}
                          {role === "admin" && <Btn size="sm" kind="red" onClick={() => removeIng(i)}>×</Btn>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {low.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-900">
              <b>Low on:</b> {low.map((i) => `${i.name} (${fmtQty(i.stock, i.unit)})`).join(" · ")}
            </div>
          )}
        </Card>

      </div>

      {edit && <IngredientModal initial={edit} onClose={() => setEdit(null)} />}
      {move && <MoveModal ing={move.ing} kind={move.kind} onClose={() => setMove(null)} />}
      {batchOpen && <BatchModal ingredients={active} products={s.products ?? []} recipes={s.recipes ?? []} onClose={() => setBatchOpen(false)} />}
    </Page>
  );
}
