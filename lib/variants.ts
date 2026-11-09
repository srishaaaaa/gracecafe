/* Product variants. A variant is an ordinary product row ("Popcorn (Large)") that also carries two short texts,
   `family` ("Popcorn") and `variant` ("Large"), used only to group and label. Nothing in billing or stock looks at them.
   A family is not a row: it has no price or stock of its own, so it can never be sold or counted by mistake. */

export type Variantish = { name: string; family?: string };

/** One entry of a grouped list: an ordinary product (`family` null) or a family with its variants in order. */
export type Entry<T> = { family: null; item: T } | { family: string; items: T[] };

/** True for a plain product that shares its name with a family ("Tea" next to "Tea (Masala)"): it is hidden from sale
    so the heading is never sold by accident. */
export const leftoverOf = <T extends Variantish>(items: T[]) => {
  const fams = new Set(items.filter((p) => p.family).map((p) => (p.family as string).toLowerCase()));
  return (p: T) => !p.family && fams.has(p.name.toLowerCase());
};

/** Turns a flat list into "one entry per plain product, one per family" — walking in order, a family is created where
    its first variant appears. Pass `hideLeftovers: false` where the leftover plain product should still be shown
    (the admin Inventory list, so it can be deleted). */
export function entries<T extends Variantish>(items: T[], hideLeftovers = true): Entry<T>[] {
  const left = hideLeftovers ? leftoverOf(items) : () => false;
  const out: Entry<T>[] = [];
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (left(it)) continue;
    if (!it.family) {
      out.push({ family: null, item: it });
      continue;
    }
    const key = it.family.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = [];
      groups.set(key, g);
      out.push({ family: it.family, items: g });
    }
    g.push(it);
  }
  return out;
}

/** "from ₹20" style range for a family. */
export const priceRange = (items: { price: number }[]) => {
  const ps = items.map((p) => p.price);
  return { min: Math.min(...ps), max: Math.max(...ps) };
};

/** Stock summary of a family: total of the tracked variants (null when none is tracked) and how many are low / out. */
export const stockSummary = (items: { stock: number | null; lowAt?: number }[]) => {
  const tracked = items.filter((p) => p.stock !== null);
  return {
    total: tracked.length ? tracked.reduce((a, p) => a + (p.stock as number), 0) : null,
    low: tracked.filter((p) => (p.stock as number) > 0 && (p.stock as number) <= (p.lowAt ?? 0)).length,
    out: tracked.filter((p) => (p.stock as number) <= 0).length,
  };
};
