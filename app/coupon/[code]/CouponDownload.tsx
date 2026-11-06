"use client";

import { useState } from "react";
import { couponPdf, downloadFile, type CouponCardData } from "@/lib/couponPdf";

export function CouponDownload({ data }: { data: CouponCardData }) {
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      downloadFile(await couponPdf(data));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={save} disabled={busy} className="flex h-12 flex-1 items-center justify-center rounded-xl bg-slate-900 text-[14px] font-bold text-white hover:bg-slate-700 disabled:opacity-60">
      {busy ? "Preparing…" : "Download PDF"}
    </button>
  );
}
