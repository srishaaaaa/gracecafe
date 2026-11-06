"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/* Small admin UI kit — Tailwind classes, one place. */

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------------- icons (24px stroke) ---------------- */
const P: Record<string, React.ReactNode> = {
  tables: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  chart: <path d="M3 3v18h18M7 16v-4M12 16V8M17 16v-7" />,
  orders: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01" />
    </>
  ),
  billing: (
    <>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8M12 17.5v-11" />
    </>
  ),
  coupon: <path d="M2 9a3 3 0 1 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 1 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2ZM9 9h.01M15 15h.01M15 9l-6 6" />,
  box: <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7l8.7 5 8.7-5M12 22V12" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7.5" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  edit: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5ZM15 5l4 4" />,
  trash: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />,
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
    </>
  ),
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  print: (
    <>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>
  ),
  external: <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />,
  refresh: <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8M21 3v5h-5" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  rupee: <path d="M6 3h12M6 8h12M6 13l8.5 8M6 13h3M9 13c6.67 0 6.67-10 0-10" />,
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      <circle cx="9" cy="7" r="4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  bell: <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />,
  belloff: <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20" />,
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  cart: (
    <>
      <circle cx="8" cy="21" r="1" />
      <circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  list: <path d="M4 6h16M4 12h11M4 18h7" />,
  sliders: <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  percent: (
    <>
      <path d="M19 5 5 19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </>
  ),
  bag: <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4ZM3 6h18M16 10a4 4 0 0 1-8 0" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
    </>
  ),
  zap: <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />,
  star: <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01Z" />,
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  utensils: <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />,
  alert: <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01" />,
  trophy: (
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  ),
  key: <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78Zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />,
  eye: (
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeoff: <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.52 13.52 0 0 0 2 11s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M14.12 14.12A3 3 0 1 1 9.88 9.88M2 2l20 20" />,
  kitchen: (
    <>
      <path d="M4 11h16M5 11v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9" />
      <path d="M12 11V6a3 3 0 0 1 3-3h.5A2.5 2.5 0 0 1 18 5.5" />
      <path d="M12 11V6a3 3 0 0 0-3-3h-.5A2.5 2.5 0 0 0 6 5.5" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18, className, stroke = 2 }: { name: IconName; size?: number; className?: string; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("shrink-0", className)}
    >
      {P[name]}
    </svg>
  );
}

export const WaIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3z" />
  </svg>
);

/* ---------------- layout ---------------- */
export function Page({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[22px] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,.06),0_8px_24px_-12px_rgba(15,23,42,.1)] sm:p-6 adm-in">{children}</div>;
}

export function PageHead({ title, sub, right, bar }: { title: string; sub?: React.ReactNode; right?: React.ReactNode; bar?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className={cx(bar && "border-l-[4px] border-red-600 pl-3")}>
        <h1 className="adm-title text-[24px] leading-[1.05] text-slate-900 sm:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-slate-500">{sub}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Card({ children, className, title, right }: { children: React.ReactNode; className?: string; title?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)] sm:p-5", className)}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-[14px] font-bold text-slate-800">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES = {
  emerald: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  sky: "bg-sky-50 text-sky-600",
  violet: "bg-violet-50 text-violet-600",
  rose: "bg-rose-50 text-rose-600",
  orange: "bg-orange-50 text-orange-500",
  slate: "bg-slate-100 text-slate-600",
  red: "bg-red-50 text-red-600",
} as const;
export type Tone = keyof typeof TONES;

/** A KPI tile. Always tappable — click opens a modal that shows the full value
    (useful on narrow phones where ₹25,133 might render as "₹25,1…" on the card)
    plus optional `details` (a list, breakdown, or whatever extra context the
    caller wants to show). */
export function Kpi({ label, value, hint, icon, tone = "emerald", small, details }: { label: string; value: React.ReactNode; hint?: string; icon: IconName; tone?: Tone; small?: boolean; details?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-w-0 cursor-pointer rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-[0_2px_10px_-2px_rgba(15,23,42,.08)] transition hover:border-slate-200 hover:shadow-[0_4px_14px_-4px_rgba(15,23,42,.15)] active:scale-[.99]"
        aria-label={`${label} — tap for details`}
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600">{label}</span>
          <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full", TONES[tone])}>
            <Icon name={icon} size={14} stroke={2.4} />
          </span>
        </div>
        <div className={cx("adm-num mt-2 truncate font-extrabold text-slate-900", small ? "text-[19px]" : "text-[23px]")} title={typeof value === "string" ? value : undefined}>
          {value}
        </div>
        {hint && <p className="mt-1.5 truncate text-[11px] text-slate-400">{hint}</p>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={label} wide={!!details}>
        <div className="space-y-4">
          <div className="rounded-2xl bg-slate-50 p-4">
            <div className="adm-num break-words text-[30px] font-extrabold leading-tight text-slate-900 sm:text-[36px]">{value}</div>
            {hint && <p className="mt-1 text-[13px] text-slate-500">{hint}</p>}
          </div>
          {details}
        </div>
      </Modal>
    </>
  );
}

/* ---------------- controls ---------------- */
const BTN = {
  red: "bg-red-600 text-white hover:bg-red-700 shadow-[0_6px_16px_-8px_rgba(107, 117, 80,.8)]",
  dark: "bg-slate-900 text-white hover:bg-slate-700",
  ghost: "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
  soft: "bg-red-50 text-red-600 border border-red-100 hover:bg-red-100",
  green: "bg-[#22c55e] text-white hover:bg-[#16a34a] shadow-[0_8px_18px_-10px_rgba(22,163,74,.9)]",
  plain: "text-slate-600 hover:bg-slate-100",
  ok: "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  warn: "border border-red-200 bg-red-50 text-red-600 hover:bg-red-100",
} as const;

export function Btn({
  kind = "ghost",
  size = "md",
  icon,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: keyof typeof BTN; size?: "sm" | "md" | "lg"; icon?: IconName }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition active:scale-[.97] disabled:pointer-events-none disabled:opacity-45",
        size === "sm" && "h-8 px-3 text-[12px]",
        size === "md" && "h-9 px-3.5 text-[13px]",
        size === "lg" && "h-11 px-5 text-[14px]",
        BTN[kind],
        className,
      )}
    >
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} stroke={2.2} />}
      {children}
    </button>
  );
}

const BADGE = {
  green: "bg-emerald-50 text-emerald-700 border-emerald-200",
  red: "bg-red-50 text-red-600 border-red-200",
  amber: "bg-amber-50 text-amber-700 border-amber-200",
  orange: "bg-orange-50 text-orange-600 border-orange-200",
  sky: "bg-sky-50 text-sky-700 border-sky-200",
  slate: "bg-slate-50 text-slate-500 border-slate-200",
  violet: "bg-violet-50 text-violet-700 border-violet-200",
} as const;
export type BadgeTone = keyof typeof BADGE;

export function Badge({ tone = "slate", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-[3px] text-[10.5px] font-bold uppercase tracking-wide", BADGE[tone], className)}>{children}</span>
  );
}

export const labelCls = "mb-1 block text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600";
export const inputCls =
  "h-10 w-full rounded-xl border border-transparent bg-slate-50 px-3.5 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-100";
export const inputLineCls =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-100";

export function Field({ label, children, className, hint }: { label: string; children: React.ReactNode; className?: string; hint?: React.ReactNode }) {
  return (
    <label className={cx("block", className)}>
      <span className={labelCls}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label
      className={cx(
        "adm-search flex h-10 items-center gap-2.5 rounded-full bg-slate-50 px-4 text-slate-400 transition focus-within:bg-white focus-within:shadow-[0_2px_10px_-3px_rgba(38,23,15,.22)]",
        className,
      )}
    >
      <Icon name="search" size={16} />
      <input
        className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-900 outline-none placeholder:text-slate-400"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {value && (
        <button type="button" onClick={() => onChange("")} className="text-slate-400 hover:text-slate-700" aria-label="Clear search">
          <Icon name="x" size={14} />
        </button>
      )}
    </label>
  );
}

/** The From → To picker that opens when a period pill says "Custom". One pill, never wider than
    its row: the two dates sit side by side and drop onto two lines on a phone. */
export function DateRange({ from, to, onFrom, onTo, className }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void; className?: string }) {
  const lbl = "flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400";
  const box = "h-8 w-[8.75rem] min-w-0 rounded-lg bg-transparent px-1 text-[13px] font-semibold text-slate-800 outline-none";
  return (
    <div
      className={cx(
        "adm-dates adm-in inline-flex max-w-full flex-wrap items-center gap-x-4 gap-y-0.5 rounded-[22px] border border-slate-200 bg-white px-4 py-1 shadow-[0_2px_8px_-2px_rgba(15,23,42,.08)] sm:rounded-full sm:py-1.5",
        className,
      )}
    >
      <label className={lbl}>
        From
        <input type="date" value={from} max={to || undefined} onChange={(e) => onFrom(e.target.value)} className={box} />
      </label>
      <label className={lbl}>
        To
        <input type="date" value={to} min={from || undefined} onChange={(e) => onTo(e.target.value)} className={box} />
      </label>
    </div>
  );
}

/** Pill group: PERIOD: [ALL TIME] TODAY … */
export function Pills<T extends string>({ label, value, options, onChange, className }: { label?: string; value: T; options: { v: T; t: string }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx("flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-slate-200 bg-white p-1 shadow-[0_2px_8px_-2px_rgba(15,23,42,.08)] adm-scroll", className)}>
      {label && <span className="shrink-0 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</span>}
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cx(
            "h-8 shrink-0 whitespace-nowrap rounded-full px-4 text-[12px] font-bold uppercase transition",
            value === o.v ? "bg-red-600 text-white shadow-[0_4px_10px_-4px_rgba(107, 117, 80,.9)]" : "text-slate-700 hover:bg-slate-100",
          )}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

/** Underlined tabs: REVENUE  TODAY'S SALES … */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { v: T; t: string; n?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-6 overflow-x-auto overflow-y-hidden border-b border-slate-200 adm-scroll">
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cx(
            "relative flex shrink-0 items-center gap-2 whitespace-nowrap pb-3 pt-1 text-[13px] font-bold uppercase tracking-[0.06em] transition",
            value === o.v ? "text-red-600" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {o.t}
          {!!o.n && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1.5 text-[10px] text-white">{o.n}</span>}
          {value === o.v && <span className="absolute inset-x-0 -bottom-px h-[2px] rounded bg-red-600" />}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-emerald-500" : "bg-slate-300")}
    >
      <span className={cx("absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform", on && "translate-x-5")} />
    </button>
  );
}

export function Empty({ icon = "box", title, children }: { icon?: IconName; title: string; children?: React.ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-10 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-50 text-slate-400">
        <Icon name={icon} size={20} />
      </span>
      <p className="font-semibold text-slate-700">{title}</p>
      {children && <div className="max-w-sm text-[13px] text-slate-500">{children}</div>}
    </div>
  );
}

/* ---------------- overlays ---------------- */
/* Overlays render into #adm-layer (in the shell), outside any animated card —
   a transformed ancestor would otherwise trap position:fixed. */
const noSub = () => () => {};
function Layer({ children }: { children: React.ReactNode }) {
  const ready = useSyncExternalStore(
    noSub,
    () => true,
    () => false,
  );
  if (!ready) return null;
  const host = document.getElementById("adm-layer");
  return host ? createPortal(children, host) : <>{children}</>;
}

/* One shared scroll lock, counted. Overlays stack — a drawer can raise the
   confirm modal on top of itself — and when each one saved and restored the
   page's overflow on its own, the inner one captured "hidden" as the value to
   put back, so the page stayed unscrollable after everything had closed.
   Only the last overlay out releases the page, and the width the scrollbar
   leaves behind is padded back so the content doesn't jump sideways. */
let locks = 0;
let prevOverflow = "";
let prevPad = "";

function lockScroll() {
  const html = document.documentElement;
  if (locks++) return;
  prevOverflow = html.style.overflow;
  prevPad = html.style.paddingRight;
  const before = html.clientWidth;
  html.style.overflow = "hidden";
  const gap = html.clientWidth - before;
  if (gap > 0) html.style.paddingRight = `${gap}px`;
}

function unlockScroll() {
  if (locks > 0 && --locks) return;
  const html = document.documentElement;
  html.style.overflow = prevOverflow;
  html.style.paddingRight = prevPad;
}

function useEsc(open: boolean, onClose: () => void) {
  /* onClose is written inline at every call site, so keep it in a ref: a new
     identity must not tear the lock down and take it again mid-render. */
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", k);
    lockScroll();
    return () => {
      window.removeEventListener("keydown", k);
      unlockScroll();
    };
  }, [open]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  useEsc(open, onClose);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLElement>("input,textarea,select")?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <Layer>
      <div className="fixed inset-0 z-[80] grid place-items-center p-3 sm:p-6" role="dialog" aria-modal="true">
        <button type="button" className="adm-scrim absolute inset-0 bg-slate-900/40" onClick={onClose} aria-label="Close" tabIndex={-1} />
        <div ref={box} className={cx("adm-in relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-3xl bg-white shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}>
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
            <h2 className="text-[16px] font-bold text-slate-900">{title}</h2>
            <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Close">
              <Icon name="x" size={16} />
            </button>
          </div>
          <div className="adm-scroll overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5">{footer}</div>}
        </div>
      </div>
    </Layer>
  );
}

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <Layer>
      <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
        <button type="button" className="adm-scrim absolute inset-0 bg-slate-900/30" onClick={onClose} aria-label="Close" tabIndex={-1} />
        <aside className="adm-drawer adm-scroll absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col overflow-y-auto bg-white shadow-2xl">{children}</aside>
      </div>
    </Layer>
  );
}

/* ---------------- misc ---------------- */
export const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "numeric", month: "numeric", year: "numeric" });
export const fmtTime = (t: number) => new Date(t).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
export const fmtDateTime = (t: number) => `${fmtDate(t)}, ${fmtTime(t)}`;
export function ago(t: number, now = Date.now()) {
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(",")).join("\n");

/* ---------------- Excel export ----------------
   A real Excel workbook, saved as .xls — SpreadsheetML 2003 XML, which every
   modern Excel (Windows, Mac, mobile) and LibreOffice opens natively, with real
   columns and number-typed cells. No library needed. Pass a single rows[][] for
   one sheet, or [{name, rows}] for a multi-sheet workbook. */
export type ExcelSheet = { name: string; rows: (string | number | null | undefined)[][] };

const xmlEsc = (v: unknown) =>
  String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const safeSheetName = (name: string, i: number) => (name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, "-").slice(0, 31);
function excelCell(v: unknown) {
  if (v == null || v === "") return `<Cell><Data ss:Type="String"></Data></Cell>`;
  if (typeof v === "number" && Number.isFinite(v)) return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  return `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
}

export function excelWorkbook(sheets: ExcelSheet[]): string {
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<?mso-application progid="Excel.Sheet"?>',
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">',
    '<Styles><Style ss:ID="h"><Font ss:Bold="1"/><Interior ss:Color="#F0F0F0" ss:Pattern="Solid"/></Style></Styles>',
  ];
  sheets.forEach((s, i) => {
    parts.push(`<Worksheet ss:Name="${xmlEsc(safeSheetName(s.name, i))}"><Table>`);
    s.rows.forEach((row, r) => {
      const style = r === 0 ? ' ss:StyleID="h"' : "";
      parts.push(`<Row${style}>${row.map(excelCell).join("")}</Row>`);
    });
    parts.push("</Table></Worksheet>");
  });
  parts.push("</Workbook>");
  return parts.join("");
}

export function downloadExcel(name: string, sheetsOrRows: ExcelSheet[] | (string | number | null | undefined)[][]) {
  const sheets: ExcelSheet[] = Array.isArray(sheetsOrRows[0]) && !("name" in (sheetsOrRows[0] as object))
    ? [{ name: "Sheet1", rows: sheetsOrRows as (string | number | null | undefined)[][] }]
    : (sheetsOrRows as ExcelSheet[]);
  const xml = excelWorkbook(sheets);
  const file = name.endsWith(".xls") || name.endsWith(".xlsx") ? name : `${name}.xls`;
  downloadText(file, xml, "application/vnd.ms-excel;charset=utf-8");
}
