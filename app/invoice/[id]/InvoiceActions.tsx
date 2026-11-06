"use client";

import { useState } from "react";
import Link from "next/link";

interface InvoiceActionsProps {
  invoiceNo: string;
  shop: string;
  customerName: string;
  customerPhone: string;
  total: number;
}

const btn = "inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-100";

export function InvoiceActions({ invoiceNo, shop, customerName, customerPhone, total }: InvoiceActionsProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const whatsapp = () => {
    const phone = customerPhone.replace(/\D/g, "").slice(-10);
    const text = `*${shop}*\nInvoice ${invoiceNo}\nCustomer: ${customerName || "Walk-in customer"}\nTotal: ₹${total.toLocaleString("en-IN", { minimumFractionDigits: 2 })}\n\nInvoice Link:\n${window.location.href}`;
    window.open(`https://api.whatsapp.com/send?${phone ? `phone=91${phone}&` : ""}text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-sm border border-zinc-200/80 bg-white p-3 shadow-xs print:hidden">
      <Link href="/admin/orders" className={`${btn} bg-zinc-50`}>
        ← Back to orders
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={whatsapp} className={`${btn} bg-zinc-50`}>
          Share WhatsApp
        </button>
        <button type="button" onClick={copy} className={`${btn} bg-white`}>
          {copied ? "Copied" : "Copy Link"}
        </button>
        <button type="button" onClick={() => window.print()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-zinc-800">
          Print
        </button>
      </div>
    </div>
  );
}
