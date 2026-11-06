"use client";

import { useEffect, useState } from "react";
import type { StockLedger } from "@/lib/types";
import { useAdmin } from "./Store";

export type LedgerQuery = { from?: number | null; to?: number | null; type?: string; pid?: string; q?: string; page?: number; size?: number };

/** Fetches one page of the stock ledger. Refetches when the query changes or the shop's data does,
    and keeps showing the previous page meanwhile so the table doesn't flash empty. */
export function useLedger(query: LedgerQuery) {
  const { s } = useAdmin();
  const [got, setGot] = useState<{ key: string; data: StockLedger } | null>(null);
  const key = JSON.stringify(query);

  useEffect(() => {
    let dead = false;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(JSON.parse(key) as LedgerQuery)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    fetch(`/api/admin/stock-movements?${p}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!dead && !d.error) setGot({ key, data: d });
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [key, s.version]);

  /* still showing the previous page until the new one lands */
  return { data: got?.data ?? null, loading: got?.key !== key };
}
