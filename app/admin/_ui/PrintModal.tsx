"use client";

import type { Bill } from "@/lib/types";
import { useAdmin } from "./Store";
import { Receipt, SHEET_SIZES, THERMAL_ROLLS, type PrintFormat } from "./receipt";
import { Icon, Modal } from "./kit";

const opt = "flex h-12 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white text-[14px] font-bold text-slate-800 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 active:scale-[.98]";

/** Printer type → paper: thermal 2"/3" roll, or A3/A4/A5 sheet. */
export function PrintFormats({ onPick }: { onPick: (f: PrintFormat) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Thermal printer · roll</span>
        <div className="flex gap-2">
          {THERMAL_ROLLS.map((r) => (
            <button key={r} type="button" className={opt} onClick={() => onPick({ kind: "thermal", roll: r })}>
              {r} inch roll
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Sheet printer · paper</span>
        <div className="flex gap-2">
          {SHEET_SIZES.map((z) => (
            <button key={z} type="button" className={opt} onClick={() => onPick({ kind: "sheet", size: z })}>
              {z}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Print an existing bill: pick the printer + paper, then it goes straight to the print dialog. */
export default function PrintModal({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const { s, print } = useAdmin();
  return (
    <Modal open={!!bill} onClose={onClose} title={bill ? `Print ${bill.invoiceNo}` : ""}>
      {bill && (
        <>
          <p className="mb-4 flex items-center gap-2 text-[13px] text-slate-500">
            <Icon name="print" size={16} /> Choose the printer and paper size — the invoice resizes to match.
          </p>
          <PrintFormats
            onPick={(fmt) => {
              print(<Receipt b={bill} shop={s.settings.shopName} details={s.settings} fmt={fmt} showLoyalty={s.loyaltyEarn.display.receiptSummary} />);
              onClose();
            }}
          />
        </>
      )}
    </Modal>
  );
}
