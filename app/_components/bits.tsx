import { Fragment } from "react";

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;

/** Word-by-word masked reveal. Parent needs data-reveal to trigger. */
export function Split({ text, from = 0 }: { text: string; from?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          <span className="sw">
            <span style={{ "--i": i + from } as CSSVars}>{w}</span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </Fragment>
      ))}
    </>
  );
}

/** Letter spans (for the masthead + footer wordmark). */
export function Letters({ text, from = 0 }: { text: string; from?: number }) {
  return (
    <>
      {Array.from(text).map((ch, i) => (
        <span className="ltr" key={i} style={{ "--i": i + from } as CSSVars}>
          <i>{ch === " " ? " " : ch}</i>
        </span>
      ))}
    </>
  );
}

/** Text that rolls up to a copy of itself on hover. */
export function Roll({ children }: { children: string }) {
  return (
    <span className="roll">
      <span data-t={children}>{children}</span>
    </span>
  );
}

/* ---------- chocolate drip divider ---------- */
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

const DW = 1440;
const BASE = 26;

function dripPath(x: number, dw: number, len: number) {
  const tw = dw * 0.62;
  const r = 9;
  const R = dw / 2;
  const y0 = BASE - 1;
  const yb = y0 + len;
  return [
    `M${x - tw / 2 - r} ${y0}`,
    `Q${x - tw / 2} ${y0} ${x - tw / 2} ${y0 + r}`,
    `C${x - tw / 2} ${yb - R * 2.2} ${x - R} ${yb - R * 1.7} ${x - R} ${yb - R}`,
    `A${R} ${R} 0 0 0 ${x + R} ${yb - R}`,
    `C${x + R} ${yb - R * 1.7} ${x + tw / 2} ${yb - R * 2.2} ${x + tw / 2} ${y0 + r}`,
    `Q${x + tw / 2} ${y0} ${x + tw / 2 + r} ${y0}Z`,
  ].join(" ");
}

export function Drip({ color, seed = 7 }: { color: string; seed?: number }) {
  const rnd = rng(seed * 9301 + 49297);
  const drips: { x: number; dw: number; len: number; d: number }[] = [];
  let x = 18 + rnd() * 50;
  while (x < DW - 20) {
    const dw = 16 + rnd() * 24;
    const len = Math.max(dw * 1.9 + 14, 26 + rnd() * 118);
    drips.push({ x, dw, len, d: Math.round(rnd() * 700) });
    x += dw + 34 + rnd() * 120;
  }
  // wavy lower edge of the band
  let band = `M0 0H${DW}V${BASE}`;
  for (let bx = DW; bx > 0; bx -= 60) {
    band += ` Q${bx - 30} ${BASE + 5 + rnd() * 6} ${Math.max(0, bx - 60)} ${BASE}`;
  }
  band += "Z";

  return (
    <svg
      className="drip"
      viewBox={`0 0 ${DW} 180`}
      preserveAspectRatio="xMidYMin slice"
      aria-hidden="true"
      data-reveal="drip"
    >
      <path d={band} fill={color} />
      {drips.map((dr, i) => (
        <path key={i} className="drip__d" d={dripPath(dr.x, dr.dw, dr.len)} fill={color} style={{ "--d": `${dr.d}ms` } as CSSVars} />
      ))}
    </svg>
  );
}

/* ---------- barcode built from the phone number ---------- */
export function Barcode({ digits }: { digits: string }) {
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  const seq = ("1" + digits.replace(/\D/g, "") + "1").split("").map(Number);
  seq.forEach((n, i) => {
    const pattern = [1 + (n % 3), 1 + ((n + i) % 2), 1 + ((n * 7) % 3), 1];
    pattern.forEach((w, j) => {
      if (j % 2 === 0) bars.push({ x, w });
      x += w + 1;
    });
  });
  return (
    <svg viewBox={`0 0 ${x} 40`} preserveAspectRatio="none" aria-hidden="true">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={i % 9 === 0 ? 40 : 34} fill="currentColor" />
      ))}
    </svg>
  );
}

/* ---------- icons ---------- */
/* the 8:2 logo in beige, straight on the menu's dark bands */
export const Cherry = ({ size = 22 }: { size?: number }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src="/logo.png" alt="" style={{ height: size + 6, width: "auto", display: "inline-block", verticalAlign: "middle" }} />
);

export const Arrow = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const WhatsApp = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3z" />
  </svg>
);

export const Phone = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);

export const Insta = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="17.6" cy="6.4" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const Mail = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="4" width="20" height="16" rx="3" />
    <path d="m3 6 9 7 9-7" />
  </svg>
);
