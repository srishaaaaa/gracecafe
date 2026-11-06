import type { Bill, ShopDetails } from "@/lib/types";
import { TZ, inr2 as inr, loyaltySummary, numberToWords, payLabel, payParts, rupee } from "@/lib/money";
import { fmtDateTime } from "./kit";


/** Public link to the printable invoice page. */
export const invoiceUrl = (b: Bill, publicUrl = "") => `${(publicUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "")}/invoice/${b.id}`;

export function billText(b: Bill, shop: string, publicUrl = "") {
  const L = [
    `*${shop}*`,
    `Invoice: ${b.invoiceNo}`,
    `Date: ${fmtDateTime(b.createdAt)}`,
    b.source === "tab" ? "Order from phone" : "Counter bill",
    b.customerName ? `Customer: ${b.customerName}` : "",
    "------------------------------",
    ...b.items.map((i) => (i.free ? `${i.qty} × ${i.name} — FREE GIFT ₹0` : `${i.qty} × ${i.name} — ${rupee(i.price * i.qty)}`)),
    "------------------------------",
    `Subtotal (${b.itemCount} items): ${rupee(b.subtotal)}`,
    b.couponDiscount ? `Coupon ${b.couponCode} (${b.couponPercent}%): -${rupee(b.couponDiscount)}` : "",
    b.manualDiscount ? `Discount: -${rupee(b.manualDiscount)}` : "",
    b.rewardDiscount ? `Reward ${b.rewardName ?? ""}: -${rupee(b.rewardDiscount)}` : "",
    b.pointsDiscount ? `Loyalty points (${b.pointsRedeemed} pts): -${rupee(b.pointsDiscount)}` : "",
    b.extra ? `Extra charges: ${rupee(b.extra)}` : "",
    b.isGst ? `GST (${b.gstPercent}%) on ${rupee(b.taxableAmount)}: ${rupee(b.gstAmount)}` : "",
    `*Grand total: ${rupee(b.total)}*`,
    `Paid by ${payLabel(b)}`,
    b.payment === "split" ? `  ${payParts(b).map(([m, n]) => `${m} ${rupee(n)}`).join(" · ")}` : "",
    ...(loyaltySummary(b) ? ["Loyalty summary", ...loyaltySummary(b)!.map(([k, v]) => `  ${k}: ${v}`)] : []),
    "",
    `View your invoice: ${invoiceUrl(b, publicUrl)}`,
    "",
    "Thank you for visiting — see you again soon!",
  ];
  return L.filter((l, i) => l !== "" || i >= L.length - 4).join("\n");
}

export const waLink = (phone: string, text: string) => `https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`;

/* ---------- print formats ---------- */
/** Thermal rolls are named by width (2" ≈ 58mm paper, 3" ≈ 80mm paper); sheets by paper size. */
export type PrintFormat = { kind: "thermal"; roll: 2 | 3 } | { kind: "sheet"; size: "A3" | "A4" | "A5" };

export const THERMAL_ROLLS = [2, 3] as const;
export const SHEET_SIZES = ["A3", "A4", "A5"] as const;
export const DEFAULT_FORMAT: PrintFormat = { kind: "thermal", roll: 3 };

/* [paper width, printable width] in mm — the printable strip is narrower than the
   roll so nothing is clipped by the printer's own margins. */
const ROLL_MM = { 2: [58, 48], 3: [80, 72] } as const;

const pageCss = (f: PrintFormat) =>
  f.kind === "thermal"
    ? `@page{size:${ROLL_MM[f.roll][0]}mm 297mm;margin:2mm 0}`
    : `@page{size:${f.size};margin:${f.size === "A3" ? 16 : f.size === "A4" ? 12 : 8}mm}`;

/** The shop's printed header lines, built from Settings. */
export function headerLines(d?: ShopDetails): string[] {
  if (!d) return [];
  const addr = (t: string) => t.split("\n").filter(Boolean).join(", ");
  const lines = [addr(d.address)].filter(Boolean);
  const contact = [d.customerCare && `Ph: ${d.customerCare}`, d.email].filter(Boolean).join(" · ");
  return contact ? [...lines, contact] : lines;
}

/** Receipt for the chosen printer, rendered into the print area. */
export function Receipt({ b: bill, shop, details, fmt = DEFAULT_FORMAT, showLoyalty = true }: { b: Bill; shop: string; details?: ShopDetails; fmt?: PrintFormat; showLoyalty?: boolean }) {
  // the owner can switch the loyalty box off in Loyalty settings
  const b = showLoyalty ? bill : { ...bill, loyaltyCustomerId: null };
  return (
    <>
      <style>{pageCss(fmt)}</style>
      {fmt.kind === "thermal" ? <Thermal b={b} shop={shop} logo={details?.logoUrl} lines={headerLines(details)} roll={fmt.roll} /> : <Sheet b={b} shop={shop} logo={details?.logoUrl} details={details} size={fmt.size} />}
    </>
  );
}

/** Full-page invoice for A3 / A4 / A5 — the same layout as the invoice page (header, billed to, items, amount in words,
    totals, signature), scaled by the paper size. */
function Sheet({ b, shop, logo, details, size }: { b: Bill; shop: string; logo?: string; details?: ShopDetails; size: "A3" | "A4" | "A5" }) {
  const date = new Date(b.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
  const time = new Date(b.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: TZ });
  const addr = (details?.address ?? "").split("\n").filter(Boolean).join(", ");
  const contact = [details?.customerCare && `Phone: ${details.customerCare}`, details?.email].filter(Boolean).join(" · ");
  const loy = loyaltySummary(b);
  return (
    <div className={`inv inv--${size.toLowerCase()}`}>
      <header className="inv__head">
        <div className="inv__brand">
          {!logo || logo === "/logo.png" ? (
            <>
              {/* the shop's own 8:2 + CHAYAKKADA logo is the whole header mark on an invoice */}
              <img src="/invoice-logo.png" alt={shop} style={{ height: "7.4em", width: "auto", maxWidth: "100%", objectFit: "contain", marginBottom: 6, display: "block" }} />
              <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>{shop}</h1>
            </>
          ) : (
            <>
              <img src={logo} alt="" style={{ height: 56, width: "auto", maxWidth: "100%", objectFit: "contain", marginBottom: 6, display: "block" }} />
              <h1>{shop}</h1>
            </>
          )}
          {addr && <p>{addr}</p>}
          {contact && <p>{contact}</p>}
        </div>
        <div className="inv__meta">
          <h2>{b.isGst ? "Tax Invoice" : "Invoice"}</h2>
          <p className="inv__no">{b.invoiceNo}</p>
          <dl>
            <div>
              <dt>Date:</dt>
              <dd>
                <b>{date}</b>
              </dd>
            </div>
            <div>
              <dt>Time:</dt>
              <dd>{time}</dd>
            </div>
            <div>
              <dt>Payment:</dt>
              <dd>
                <b>
                  {payLabel(b)} • {b.status === "void" ? "VOID" : "PAID"}
                </b>
              </dd>
            </div>
            <div>
              <dt>Channel:</dt>
              <dd>{b.source === "tab" ? "ORDER FROM PHONE" : "COUNTER"}</dd>
            </div>
          </dl>
        </div>
      </header>

      <section className="inv__to">
        <span>Billed to</span>
        <b>{b.customerName.trim() || "Walk-in customer"}</b>
        {b.customerPhone ? <p className="inv__mono">+91 {b.customerPhone}</p> : <p className="inv__it">Walk-in Counter Sale</p>}
      </section>

      <table className="inv__tbl">
        <thead>
          <tr>
            <th className="c">#</th>
            <th>Item Description</th>
            <th className="c">Qty</th>
            <th className="n">Rate (₹)</th>
            <th className="n">Amount (₹)</th>
          </tr>
        </thead>
        <tbody>
          {b.items.map((i, k) => (
            <tr key={k}>
              <td className="c inv__mono">{k + 1}</td>
              <td>
                <b>{i.free ? `FREE GIFT · ${i.name}` : i.name}</b>
              </td>
              <td className="c">{i.qty}</td>
              <td className="n inv__mono">{i.free ? "FREE" : inr(i.price)}</td>
              <td className="n inv__mono">
                <b>{i.free ? "0.00" : inr(i.qty * i.price)}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="inv__bottom">
        <div className="inv__left">
          <span className="inv__lbl">Amount in words</span>
          <p className="inv__words">{numberToWords(b.total)}</p>
          {b.payment === "split" && (
            <div className="inv__pay">
              {payParts(b).map(([m, n]) => (
                <p key={m}>
                  Paid by {m}: <b className="inv__mono">₹{inr(n)}</b>
                </p>
              ))}
            </div>
          )}
          {b.payment === "cash" && b.received > 0 && (
            <div className="inv__pay">
              <p>
                Cash Received: <b className="inv__mono">₹{inr(b.received)}</b>
              </p>
              {b.change > 0 && (
                <p>
                  Change Returned: <b className="inv__mono">₹{inr(b.change)}</b>
                </p>
              )}
            </div>
          )}
          <div className="inv__terms">
            <p>
              <b>Terms &amp; Notes:</b>
            </p>
            <p>{b.isGst ? `• Prices are in Indian Rupees; GST @ ${b.gstPercent}% is added to the amount.` : "• Prices are in Indian Rupees. GST is not applicable on this bill."}</p>
            <p>• Please keep this invoice for your records.</p>
          </div>
        </div>

        <dl className="inv__sum">
          <div>
            <dt>Subtotal ({b.itemCount} items)</dt>
            <dd>₹{inr(b.subtotal)}</dd>
          </div>
          {b.couponDiscount > 0 && (
            <div>
              <dt>
                Coupon {b.couponCode} ({b.couponPercent}%)
              </dt>
              <dd>− ₹{inr(b.couponDiscount)}</dd>
            </div>
          )}
          {b.manualDiscount > 0 && (
            <div>
              <dt>Discount {b.manualType === "percent" ? `(${b.manualValue}%)` : ""}</dt>
              <dd>− ₹{inr(b.manualDiscount)}</dd>
            </div>
          )}
          {b.rewardDiscount > 0 && (
            <div>
              <dt>Reward {b.rewardName}</dt>
              <dd>− ₹{inr(b.rewardDiscount)}</dd>
            </div>
          )}
          {b.pointsDiscount > 0 && (
            <div>
              <dt>Loyalty points ({b.pointsRedeemed} pts)</dt>
              <dd>− ₹{inr(b.pointsDiscount)}</dd>
            </div>
          )}
          {b.extra > 0 && (
            <div className="inv__sep">
              <dt>Extra charges</dt>
              <dd>₹{inr(b.extra)}</dd>
            </div>
          )}
          {b.isGst && (
            <>
              <div className="inv__sep">
                <dt>Taxable amount</dt>
                <dd>₹{inr(b.taxableAmount)}</dd>
              </div>
              <div>
                <dt>GST ({b.gstPercent}%)</dt>
                <dd>₹{inr(b.gstAmount)}</dd>
              </div>
            </>
          )}
          <div className="inv__tot">
            <dt>TOTAL</dt>
            <dd>₹{inr(b.total)}</dd>
          </div>
        </dl>
      </div>

      {loy && (
        <div className="inv__loy">
          <b>LOYALTY SUMMARY</b>
          {loy.map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b className="inv__mono">{v}</b>
            </div>
          ))}
        </div>
      )}

      <footer className="inv__foot">
        <span>Thank you for visiting! • {shop}</span>
        <div className="inv__sign">
          <i />
          <b>Authorised Signatory</b>
          <small>For {shop}</small>
        </div>
      </footer>
    </div>
  );
}

function Thermal({ b, shop, logo, lines, roll }: { b: Bill; shop: string; logo?: string; lines: string[]; roll: 2 | 3 }) {
  return (
    <div className={`rcpt rcpt--${roll}`} style={{ width: `${ROLL_MM[roll][1]}mm` }}>
      {!logo || logo === "/logo.png" ? (
        <>
          {/* the 8:2 + CHAYAKKADA logo, in pure black and white so a thermal printer prints it sharply */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/invoice-logo-bw.png" alt={shop} style={{ width: "100%", height: "auto", margin: "0 auto 4px", display: "block", imageRendering: "pixelated" }} />
          <h1 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>{shop}</h1>
        </>
      ) : (
        <>
          <img src={logo} alt="" style={{ height: 44, width: "auto", maxWidth: "100%", objectFit: "contain", margin: "0 auto 4px", display: "block" }} />
          <h1>{shop}</h1>
        </>
      )}
      {lines.map((l, i) => <p className="c" key={i}>{l}</p>)}
      <hr />
      {b.isGst && <p className="c">TAX INVOICE</p>}
      <div className="row">
        <span>{b.invoiceNo}</span>
        <span>{b.source === "tab" ? "Customer tab" : "Counter"}</span>
      </div>
      <div>{fmtDateTime(b.createdAt)}</div>
      {b.customerName && <div>{b.customerName}{b.customerPhone ? ` · ${b.customerPhone}` : ""}</div>}
      <hr />
      {b.items.map((i, k) => (
        <div key={k}>
          <div>{i.free ? `FREE GIFT · ${i.name}` : i.name}</div>
          <div className="row">
            <span>
              {i.qty} × {i.free ? "FREE" : rupee(i.price)}
            </span>
            <span>{i.free ? "₹0" : rupee(i.qty * i.price)}</span>
          </div>
        </div>
      ))}
      <hr />
      <div className="row">
        <span>Subtotal ({b.itemCount})</span>
        <span>{rupee(b.subtotal)}</span>
      </div>
      {b.couponDiscount > 0 && (
        <div className="row">
          <span>
            {b.couponCode} ({b.couponPercent}%)
          </span>
          <span>-{rupee(b.couponDiscount)}</span>
        </div>
      )}
      {b.manualDiscount > 0 && (
        <div className="row">
          <span>Discount</span>
          <span>-{rupee(b.manualDiscount)}</span>
        </div>
      )}
      {b.rewardDiscount > 0 && (
        <div className="row">
          <span>Reward {b.rewardName}</span>
          <span>-{rupee(b.rewardDiscount)}</span>
        </div>
      )}
      {b.pointsDiscount > 0 && (
        <div className="row">
          <span>Loyalty points ({b.pointsRedeemed} pts)</span>
          <span>-{rupee(b.pointsDiscount)}</span>
        </div>
      )}
      {b.extra > 0 && (
        <div className="row">
          <span>Extra charges</span>
          <span>{rupee(b.extra)}</span>
        </div>
      )}
      {b.isGst && (
        <div className="row">
          <span>GST ({b.gstPercent}%)</span>
          <span>{rupee(b.gstAmount)}</span>
        </div>
      )}
      <hr />
      <div className="row big">
        <span>TOTAL</span>
        <span>{rupee(b.total)}</span>
      </div>
      {b.payment === "split" ? (
        payParts(b).map(([m, n]) => (
          <div key={m} className="row">
            <span>Paid · {m}</span>
            <span>{rupee(n)}</span>
          </div>
        ))
      ) : (
        <div className="row">
          <span>Paid · {payLabel(b)}</span>
          <span>{rupee(b.received)}</span>
        </div>
      )}
      {b.change > 0 && (
        <div className="row">
          <span>Change</span>
          <span>{rupee(b.change)}</span>
        </div>
      )}
      {loyaltySummary(b) && (
        <>
          <hr />
          <div>
            <b>Loyalty summary</b>
          </div>
          {loyaltySummary(b)!.map(([k, v]) => (
            <div key={k} className="row">
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
        </>
      )}
      <hr />
      <p className="c">thank you — come again</p>
    </div>
  );
}
