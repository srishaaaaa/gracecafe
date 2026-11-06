"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { WhatsApp, Phone } from "@/app/_components/bits";

/* ============================================================
   CAKE LAB — build a cake, watch it assemble, send it to the chef
   ============================================================ */

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;

const OCCASIONS = ["Birthday", "Wedding", "Anniversary", "Baby shower", "Just because"] as const;

const SPONGES = {
  chocolate: { label: "Chocolate", c: "#5b3121", d: "#40210f" },
  vanilla: { label: "Vanilla", c: "#f0d49a", d: "#d4b170" },
  redvelvet: { label: "Red Velvet", c: "#a3212f", d: "#7a1621" },
  pistachio: { label: "Pistachio", c: "#b7c485", d: "#919f60" },
  coffee: { label: "Coffee", c: "#a0714a", d: "#79522f" },
} as const;
type SpongeId = keyof typeof SPONGES;

const FINISHES = {
  buttercream: { label: "Buttercream", body: "#f6ead4", top: "#fbf3e6", shell: "#fffaf1", drip: null, ink: "#5a3120" },
  ganache: { label: "Ganache drip", body: "#f3e5cc", top: "#3a1d12", shell: "#fff6e8", drip: "#3a1d12", ink: "#5a3120" },
  chocolate: { label: "Chocolate glaze", body: "#4d2819", top: "#2e160c", shell: "#f6ead4", drip: "#2e160c", ink: "#f5ecdc" },
  berry: { label: "Berry glaze", body: "#f5d6d1", top: "#c4213a", shell: "#fff3f1", drip: "#c4213a", ink: "#8a1627" },
  naked: { label: "Semi-naked", body: "", top: "#f8eedd", shell: "#fff8ec", drip: null, ink: "#fff8ec" },
} as const;
type FinishId = keyof typeof FINISHES;

const TOPPINGS = {
  cherries: { label: "Cherries", dot: "#c8102e" },
  berries: { label: "Berries", dot: "#3d4a86" },
  candles: { label: "Candles", dot: "#e2a75c" },
  sprinkles: { label: "Sprinkles", dot: "#f2a7b5" },
  macarons: { label: "Macarons", dot: "#bfd39a" },
  mint: { label: "Mint leaves", dot: "#7fa35a" },
  stars: { label: "Gold stars", dot: "#d9a441" },
} as const;
type ToppingId = keyof typeof TOPPINGS;

const DIETS = {
  vegan: { label: "Vegan", flag: "#b3c68b" },
  glutenfree: { label: "Gluten-free", flag: "#e2a75c" },
  sugarfree: { label: "Sugar-free", flag: "#f2b8b5" },
} as const;
type DietId = keyof typeof DIETS;

type Config = {
  occasion: string;
  tiers: 1 | 2 | 3;
  sponge: SpongeId;
  finish: FinishId;
  toppings: ToppingId[];
  diet: DietId[];
  message: string;
};

const DEFAULT: Config = {
  occasion: "Birthday",
  tiers: 2,
  sponge: "chocolate",
  finish: "ganache",
  toppings: ["cherries", "candles"],
  diet: [],
  message: "",
};

const TIER_DIMS: Record<1 | 2 | 3, { w: number; h: number }[]> = {
  1: [{ w: 256, h: 128 }],
  2: [{ w: 272, h: 104 }, { w: 188, h: 94 }],
  3: [{ w: 284, h: 86 }, { w: 212, h: 80 }, { w: 144, h: 74 }],
};

const CX = 200;
const PY = 388; // plate / bottom-tier ellipse centre

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* drip band along the front arc of a tier's top ellipse */
function dripPath(rx: number, ry: number, yTop: number, h: number, seed: number) {
  const rnd = rng(seed);
  const n = Math.max(5, Math.round(rx / 15));
  const drips = Array.from({ length: n }, (_, k) => ({
    x: CX - rx + ((k + 0.25 + rnd() * 0.5) / n) * rx * 2,
    hw: 4.5 + rnd() * 3,
    L: 10 + rnd() * h * 0.42,
  }));
  const N = 170;
  const top: string[] = [];
  const bot: string[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = CX - rx + t * rx * 2;
    const arc = yTop + ry * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
    let off = 5 + Math.sin(t * 19) * 1.2;
    for (const d of drips) {
      const u = Math.abs(x - d.x) / d.hw;
      if (u < 1) off = Math.max(off, d.L - d.hw + d.hw * Math.sqrt(1 - u * u));
      else if (u < 1.7) off = Math.max(off, 5 + (d.hw * 0.9) * (1 - (u - 1) / 0.7) ** 2);
    }
    top.push(`${x.toFixed(1)} ${arc.toFixed(1)}`);
    bot.unshift(`${x.toFixed(1)} ${(arc + off).toFixed(1)}`);
  }
  return `M${top.join(" L")} L${bot.join(" L")}Z`;
}

/* points along the front arc (for piped shells) */
function frontArc(rx: number, ry: number, y: number, step: number) {
  const n = Math.max(6, Math.round((rx * 2) / step));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return { x: CX - rx + t * rx * 2, y: y + ry * Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2)) };
  });
}

function hashCfg(c: Config) {
  const s = JSON.stringify(c);
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return String(h).padStart(4, "0");
}

export default function CakeLab() {
  const [cfg, setCfg] = useState<Config>(DEFAULT);
  const [pulse, setPulse] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const toggle = <K extends "toppings" | "diet">(k: K, v: Config[K][number]) =>
    setCfg((c) => {
      const list = c[k] as string[];
      return { ...c, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] };
    });

  // menu rows elsewhere on the page carry presets: <a data-preset='{...}'>
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest<HTMLElement>("[data-preset]");
      if (!a?.dataset.preset) return;
      try {
        const p = JSON.parse(a.dataset.preset);
        setCfg((c) => ({ ...c, ...p, diet: c.diet, message: c.message }));
        setPulse((n) => n + 1);
      } catch {}
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const surprise = (e: React.MouseEvent) => {
    const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
    const tops = (Object.keys(TOPPINGS) as ToppingId[]).filter(() => Math.random() < 0.4);
    setCfg((c) => ({
      ...c,
      occasion: pick(OCCASIONS),
      tiers: pick([1, 2, 3] as const),
      sponge: pick(Object.keys(SPONGES) as SpongeId[]),
      finish: pick(Object.keys(FINISHES) as FinishId[]),
      toppings: tops.length ? tops : ["cherries"],
    }));
    setPulse((n) => n + 1);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    window.dispatchEvent(new CustomEvent("fx:burst", { detail: { x: r.left + r.width / 2, y: r.top, n: 46 } }));
    const b = boardRef.current?.getBoundingClientRect();
    if (b) window.dispatchEvent(new CustomEvent("fx:burst", { detail: { x: b.left + b.width / 2, y: b.top + b.height * 0.35, n: 36 } }));
  };

  const sponge = SPONGES[cfg.sponge];
  const fin = FINISHES[cfg.finish];
  const bodyFill = cfg.finish === "naked" ? sponge.c : fin.body;
  const drip = fin.drip;

  /* ---------- geometry ---------- */
  const tiers = useMemo(() => {
    const dims = TIER_DIMS[cfg.tiers];
    const out: { w: number; h: number; rx: number; ry: number; yBot: number; yTop: number; k: number }[] = [];
    for (let k = 0, y = PY; k < dims.length; y -= dims[k].h, k++) {
      const rx = dims[k].w / 2;
      out.push({ ...dims[k], rx, ry: rx * 0.2, yBot: y, yTop: y - dims[k].h, k });
    }
    return out;
  }, [cfg.tiers]);
  const topT = tiers[tiers.length - 1];

  const spot = (deg: number, rf: number) => {
    const a = (deg * Math.PI) / 180;
    return { x: CX + topT.rx * rf * Math.cos(a), y: topT.yTop + topT.ry * rf * Math.sin(a) };
  };

  const sprinkles = useMemo(() => {
    const rnd = rng(11 + cfg.tiers * 7);
    const cols = ["#d7263d", "#f2b8b5", "#b3c68b", "#e2a75c", "#6bb3d6", "#fff4d6"];
    const out: { x: number; y: number; r: number; c: string }[] = [];
    for (let i = 0; i < 44; i++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * 0.9;
      out.push({ x: CX + Math.cos(a) * topT.rx * rr, y: topT.yTop + Math.sin(a) * topT.ry * rr, r: rnd() * 180, c: cols[i % cols.length] });
    }
    for (let i = 0; i < 26; i++) {
      out.push({
        x: CX - topT.rx * 0.9 + rnd() * topT.rx * 1.8,
        y: topT.yTop + topT.ry + 8 + rnd() * (topT.h - 14),
        r: rnd() * 180,
        c: cols[(i + 3) % cols.length],
      });
    }
    return out;
  }, [cfg.tiers, topT]);

  const has = (t: ToppingId) => cfg.toppings.includes(t);
  const big = topT.rx > 100;

  /* toppings, each list sorted back-to-front */
  const cherries = (big ? [200, 235, 270, 305, 340, 30, 150] : [205, 260, 320, 30, 150]).map((d) => spot(d, 0.66)).sort((a, b) => a.y - b.y);
  const berries = (big ? [190, 222, 255, 288, 320, 352, 20, 60, 120, 160] : [200, 250, 300, 345, 40, 140]).map((d, i) => ({ ...spot(d, i % 2 ? 0.8 : 0.52), blue: i % 3 === 1 })).sort((a, b) => a.y - b.y);
  const candles = (big ? [-0.5, -0.25, 0, 0.25, 0.5] : [-0.34, 0, 0.34]).map((f, i) => ({ x: CX + topT.rx * f, y: topT.yTop + (i % 2 ? -3 : 2) }));
  const macarons = [215, 255, 290, 325].map((d) => spot(d, 0.74)).map((p, i) => ({ ...p, c: ["#f2a7b5", "#bfd39a", "#e8b877", "#b98a6a"][i] }));
  const mint = [{ ...spot(110, 0.2), r: -30 }, { ...spot(70, 0.3), r: 200 }, { ...spot(250, 0.3), r: 140 }];
  const stars = [-0.3, 0.08, 0.38].map((f, i) => ({ x: CX + topT.rx * f, y: topT.yTop - 2, h: 40 + i * 12 }));
  const flags = cfg.diet.map((d, i) => {
    const p = spot([235, 305, 205, 335][i], 0.55);
    return { ...p, id: d, label: DIETS[d].label.toUpperCase(), c: DIETS[d].flag };
  });

  const msg = cfg.message.trim();
  const msgSize = Math.min(28, (topT.w * 0.84) / Math.max(1, msg.length * 0.46));

  /* ---------- WhatsApp order ---------- */
  const lines = [
    "Hi Chef Loving Cakes! I'd love to order a cake 🎂",
    `• Occasion: ${cfg.occasion}`,
    `• Tiers: ${cfg.tiers}`,
    `• Sponge: ${sponge.label}`,
    `• Finish: ${fin.label}`,
    `• Toppings: ${cfg.toppings.length ? cfg.toppings.map((t) => TOPPINGS[t].label).join(", ") : "None"}`,
    ...(cfg.diet.length ? [`• Dietary: ${cfg.diet.map((d) => DIETS[d].label).join(", ")}`] : []),
    ...(msg ? [`• Message on cake: "${msg}"`] : []),
    "",
    "(Designed in your Cake Lab)",
  ];
  const wa = `https://wa.me/918056895352?text=${encodeURIComponent(lines.join("\n"))}`;
  const ticketNo = hashCfg(cfg);

  const tierKey = `t${cfg.tiers}`;

  return (
    <div className="lab">
      {/* ---------------- live preview ---------------- */}
      <div className="lab__preview">
        <div className={`lab__board ${pulse ? "is-pulse" : ""}`} key={`pulse${pulse}`} ref={boardRef}>
          <div className="lab__corner lab__corner--tl">Spec sheet · Nº {ticketNo}</div>
          <div className="lab__corner lab__corner--tr">For: {cfg.occasion}</div>
          <div className="lab__corner lab__corner--bl">Scale 1:4 · Kodaikanal</div>

          <svg className="lab__svg" viewBox="0 0 480 470" role="img" aria-label={`Preview: ${cfg.tiers}-tier ${sponge.label} cake with ${fin.label}`}>
            <defs>
              <linearGradient id="cyl" x1="0" x2="1">
                <stop offset="0" stopColor="#000" stopOpacity=".26" />
                <stop offset=".16" stopColor="#fff" stopOpacity=".16" />
                <stop offset=".42" stopColor="#fff" stopOpacity="0" />
                <stop offset=".8" stopColor="#000" stopOpacity=".08" />
                <stop offset="1" stopColor="#000" stopOpacity=".3" />
              </linearGradient>
              <linearGradient id="sheen" x1="0" x2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset=".5" stopColor="#fff" stopOpacity=".35" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="standG" x1="0" x2="1">
                <stop offset="0" stopColor="#140b07" />
                <stop offset=".3" stopColor="#4a2e20" />
                <stop offset=".55" stopColor="#24150e" />
                <stop offset="1" stopColor="#0e0704" />
              </linearGradient>
              <radialGradient id="flameGlow">
                <stop offset="0" stopColor="#ffd27a" stopOpacity=".75" />
                <stop offset="1" stopColor="#ffd27a" stopOpacity="0" />
              </radialGradient>
              <pattern id="candleStripe" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
                <rect width="8" height="8" fill="#fff6e6" />
                <rect width="3.5" height="8" fill="#d7263d" />
              </pattern>
              <clipPath id="bodies">
                {tiers.map((t) => (
                  <path key={t.k} d={`M${CX - t.rx} ${t.yTop} L${CX - t.rx} ${t.yBot} A${t.rx} ${t.ry} 0 0 0 ${CX + t.rx} ${t.yBot} L${CX + t.rx} ${t.yTop}Z`} />
                ))}
              </clipPath>
            </defs>

            {/* shadow + turntable stand */}
            <ellipse cx={CX} cy={452} rx={120} ry={10} fill="#26170f" opacity=".16" />
            <path d={`M${CX - 30} ${PY + 30} L${CX - 16} 432 L${CX + 16} 432 L${CX + 30} ${PY + 30}Z`} fill="url(#standG)" />
            <ellipse cx={CX} cy={440} rx={66} ry={11} fill="url(#standG)" />
            <ellipse cx={CX} cy={436} rx={66} ry={11} fill="#3a2418" />
            <path d={`M${CX - 152} ${PY} L${CX - 152} ${PY + 9} A152 30 0 0 0 ${CX + 152} ${PY + 9} L${CX + 152} ${PY}Z`} fill="url(#standG)" />
            <ellipse cx={CX} cy={PY} rx={152} ry={30} fill="#2e1c13" />
            <ellipse cx={CX} cy={PY} rx={146} ry={27} fill="none" stroke="#f5ecdc" strokeOpacity=".22" strokeWidth="1.2" strokeDasharray="2 9" />

            {/* tiers */}
            <g key={tierKey}>
              {tiers.map((t) => {
                const body = `M${CX - t.rx} ${t.yTop} L${CX - t.rx} ${t.yBot} A${t.rx} ${t.ry} 0 0 0 ${CX + t.rx} ${t.yBot} L${CX + t.rx} ${t.yTop}Z`;
                const shellsBot = frontArc(t.rx, t.ry, t.yBot, 12.5);
                const shellsTop = frontArc(t.rx, t.ry, t.yTop, 11);
                return (
                  <g className="lab__tier" key={t.k} style={{ "--k": t.k } as CSSVars}>
                    <path d={body} fill={bodyFill} className="lab__fill" />
                    {cfg.finish === "naked" && (
                      <g>
                        {[0.33, 0.66].map((f) => (
                          <rect key={f} x={CX - t.rx} y={t.yTop + t.ry + (t.h - t.ry) * f - 4} width={t.rx * 2} height={7} fill="#fff4e2" opacity=".92" clipPath="url(#bodies)" />
                        ))}
                        <path d={body} fill="#fff6e8" opacity=".3" />
                      </g>
                    )}
                    <path d={body} fill="url(#cyl)" />
                    <ellipse cx={CX} cy={t.yTop} rx={t.rx} ry={t.ry} fill={drip ?? fin.top} className="lab__fill" />
                    {drip ? (
                      <g className="lab__drip" key={`${cfg.finish}${t.k}`}>
                        <path d={dripPath(t.rx, t.ry, t.yTop, t.h, 31 + t.k * 17)} fill={drip} className="lab__fill" />
                        <path d={`M${CX - t.rx * 0.7} ${t.yTop + t.ry * 0.2} A${t.rx * 0.8} ${t.ry * 0.7} 0 0 0 ${CX + t.rx * 0.2} ${t.yTop + t.ry * 0.62}`} stroke="#fff" strokeOpacity=".22" strokeWidth="2.5" fill="none" strokeLinecap="round" />
                      </g>
                    ) : (
                      <g className="lab__shells">
                        {shellsTop.map((p, i) => (
                          <circle key={i} cx={p.x} cy={p.y} r={5.2} fill={fin.shell} />
                        ))}
                      </g>
                    )}
                    <g className="lab__shells">
                      {shellsBot.map((p, i) => (
                        <g key={i}>
                          <circle cx={p.x} cy={p.y - 2} r={7} fill={fin.shell} />
                          <path d={`M${p.x - 3} ${p.y - 6} q3 3 6 0`} stroke="#000" strokeOpacity=".08" fill="none" />
                        </g>
                      ))}
                    </g>
                  </g>
                );
              })}
            </g>

            {/* travelling sheen across the frosting */}
            <g clipPath="url(#bodies)">
              <rect className="lab__sheen" x={-60} y={0} width={46} height={470} fill="url(#sheen)" />
            </g>

            {/* message piped onto the top tier */}
            {msg && (
              <text
                key={`m${msg}${tierKey}`}
                className="lab__msg"
                x={CX}
                y={topT.yBot - topT.h * 0.26}
                textAnchor="middle"
                fontSize={msgSize}
                fill={fin.ink}
              >
                {msg}
              </text>
            )}

            {/* sprinkles */}
            {has("sprinkles") && (
              <g className="lab__top" key={`spr${tierKey}`}>
                {sprinkles.map((s, i) => (
                  <rect key={i} x={s.x - 3} y={s.y - 1} width={6} height={2.2} rx={1.1} fill={s.c} transform={`rotate(${s.r} ${s.x} ${s.y})`} />
                ))}
              </g>
            )}

            {/* dietary flags on toothpicks */}
            {flags.map((f, i) => {
              const w = f.label.length * 5.6 + 12;
              return (
                <g key={`${f.id}${tierKey}`} className="lab__drop" style={{ "--n": i } as CSSVars}>
                  <line x1={f.x} y1={f.y + 4} x2={f.x} y2={f.y - 54} stroke="#c9a27a" strokeWidth="1.6" />
                  <path d={`M${f.x} ${f.y - 54} h${w} l-5 8 l5 8 h${-w}z`} fill={f.c} stroke="#26170f" strokeOpacity=".15" />
                  <text x={f.x + w / 2 - 2} y={f.y - 42.5} textAnchor="middle" fontSize="8.2" fontWeight="700" letterSpacing=".06em" fill="#26170f" style={{ fontFamily: "var(--body)" }}>
                    {f.label}
                  </text>
                </g>
              );
            })}

            {has("macarons") &&
              macarons.map((m, i) => (
                <g key={`mac${i}${tierKey}`} className="lab__drop" style={{ "--n": i } as CSSVars}>
                  <ellipse cx={m.x} cy={m.y - 3} rx={11} ry={5} fill={m.c} />
                  <rect x={m.x - 10} y={m.y - 8} width={20} height={4} fill="#fff4e2" />
                  <ellipse cx={m.x} cy={m.y - 9} rx={11} ry={5} fill={m.c} />
                  <ellipse cx={m.x - 3} cy={m.y - 11} rx={4} ry={1.5} fill="#fff" opacity=".4" />
                </g>
              ))}

            {has("mint") &&
              mint.map((l, i) => (
                <g key={`mint${i}${tierKey}`} className="lab__drop" style={{ "--n": i + 2 } as CSSVars}>
                  <g transform={`translate(${l.x} ${l.y - 2}) rotate(${l.r})`}>
                    <path d="M0 0 C6 -8 16 -8 22 0 C16 6 6 6 0 0Z" fill="#7fa35a" />
                    <path d="M1 0 H20" stroke="#5c7f3c" strokeWidth=".9" />
                  </g>
                </g>
              ))}

            {has("berries") &&
              berries.map((b, i) =>
                b.blue ? (
                  <g key={`b${i}${tierKey}`} className="lab__drop" style={{ "--n": i } as CSSVars}>
                    <circle cx={b.x} cy={b.y - 5} r={6} fill="#3d4a86" />
                    <circle cx={b.x - 2} cy={b.y - 7} r={1.8} fill="#9aa6d6" opacity=".7" />
                  </g>
                ) : (
                  <g key={`b${i}${tierKey}`} className="lab__drop" style={{ "--n": i } as CSSVars}>
                    <circle cx={b.x} cy={b.y - 6} r={7} fill="#d62c4a" />
                    {[[-3, -8], [2, -9], [-1, -4], [3, -4], [-4, -3]].map(([dx, dy], j) => (
                      <circle key={j} cx={b.x + dx} cy={b.y + dy} r={1.3} fill="#9d1830" />
                    ))}
                  </g>
                ),
              )}

            {has("cherries") &&
              cherries.map((c, i) => (
                <g key={`c${i}${tierKey}`} className="lab__drop" style={{ "--n": i } as CSSVars}>
                  <path d={`M${c.x} ${c.y - 14} q2 -12 11 -17`} stroke="#4a3212" strokeWidth="1.7" fill="none" strokeLinecap="round" />
                  <circle cx={c.x} cy={c.y - 8} r={8.5} fill="#c8102e" />
                  <ellipse cx={c.x - 3} cy={c.y - 11} rx={2.6} ry={1.7} fill="#fff" opacity=".6" />
                </g>
              ))}

            {has("stars") &&
              stars.map((s, i) => (
                <g key={`st${i}${tierKey}`} className="lab__drop" style={{ "--n": i } as CSSVars}>
                  <line x1={s.x} y1={s.y} x2={s.x} y2={s.y - s.h} stroke="#b8893d" strokeWidth="1.4" />
                  <g>
                    <polygon
                      points={Array.from({ length: 10 }, (_, j) => {
                        const r = j % 2 ? 4.2 : 10;
                        const a = (Math.PI / 5) * j - Math.PI / 2;
                        return `${(s.x + Math.cos(a) * r).toFixed(1)},${(s.y - s.h + Math.sin(a) * r).toFixed(1)}`;
                      }).join(" ")}
                      fill="#e2b04f"
                      stroke="#b8893d"
                      strokeWidth="1"
                    />
                  </g>
                </g>
              ))}

            {has("candles") &&
              candles.map((c, i) => (
                <g key={`cd${i}${tierKey}`} className="lab__drop" style={{ "--n": i } as CSSVars}>
                  <circle cx={c.x} cy={c.y - 44} r={16} fill="url(#flameGlow)" />
                  <rect x={c.x - 3.2} y={c.y - 34} width={6.4} height={34} rx={1.5} fill="url(#candleStripe)" />
                  <line x1={c.x} y1={c.y - 34} x2={c.x} y2={c.y - 38} stroke="#26170f" strokeWidth="1.2" />
                  <g>
                    <path d={`M${c.x} ${c.y - 52} C${c.x + 5} ${c.y - 45} ${c.x + 5} ${c.y - 38} ${c.x} ${c.y - 37} C${c.x - 5} ${c.y - 38} ${c.x - 5} ${c.y - 45} ${c.x} ${c.y - 52}Z`} fill="#ffb238" />
                    <path d={`M${c.x} ${c.y - 47} C${c.x + 2.5} ${c.y - 43} ${c.x + 2.5} ${c.y - 39} ${c.x} ${c.y - 38.5} C${c.x - 2.5} ${c.y - 39} ${c.x - 2.5} ${c.y - 43} ${c.x} ${c.y - 47}Z`} fill="#fff3c4" />
                  </g>
                </g>
              ))}

            {/* the slice on its own little plate */}
            <g className="lab__slice" key={`slice${cfg.sponge}${cfg.finish}`}>
              <ellipse cx={414} cy={424} rx={54} ry={11} fill="#fffaf1" stroke="#26170f" strokeOpacity=".12" />
              <ellipse cx={414} cy={423} rx={40} ry={7} fill="none" stroke="#26170f" strokeOpacity=".07" />
              <path d="M444 372 L432 346 L432 394 L444 420Z" fill={sponge.d} />
              {cfg.finish !== "naked" && <path d="M444 372 L432 346 L432 351 L444 377Z" fill={fin.body || fin.top} />}
              {(() => {
                const bands =
                  cfg.finish === "naked"
                    ? [{ h: 14, c: sponge.c }, { h: 5, c: "#fff4e2" }, { h: 14, c: sponge.c }, { h: 5, c: "#fff4e2" }, { h: 10, c: sponge.c }]
                    : [{ h: 6, c: fin.body }, { h: 12, c: sponge.c }, { h: 5, c: "#fff4e2" }, { h: 12, c: sponge.c }, { h: 5, c: "#fff4e2" }, { h: 8, c: sponge.c }];
                let y = 372;
                return bands.map((b, i) => {
                  const r = <rect key={i} x={384} y={y} width={60} height={b.h} fill={b.c} className="lab__fill" />;
                  y += b.h;
                  return r;
                });
              })()}
              <path d="M384 372 L444 372 L432 346Z" fill={drip ?? fin.top} className="lab__fill" />
              {has("cherries") && (
                <g>
                  <path d="M422 352 q2 -10 9 -13" stroke="#4a3212" strokeWidth="1.5" fill="none" />
                  <circle cx={421} cy={356} r={6.5} fill="#c8102e" />
                  <ellipse cx={419} cy={354} rx={2} ry={1.3} fill="#fff" opacity=".6" />
                </g>
              )}
            </g>

            {/* handwritten annotations */}
            <g className="lab__note" style={{ fontFamily: "var(--hand)" }}>
              <text x={414} y={318} textAnchor="middle" fontSize="19" fill="#6b5344">
                {sponge.label} sponge
              </text>
              <path d="M420 324 c6 6 4 12 -2 18" stroke="#6b5344" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              <path d="M414 339 l4 4 l5 -3" stroke="#6b5344" strokeWidth="1.4" fill="none" strokeLinecap="round" />
              <text x={8} y={Math.max(40, topT.yTop - 64)} fontSize="19" fill="#6b5344">
                {fin.label}
              </text>
              <path
                d={`M30 ${Math.max(40, topT.yTop - 58)} C40 ${topT.yTop - 30} ${CX - topT.rx - 20} ${topT.yTop - 10} ${CX - topT.rx + 8} ${topT.yTop + 4}`}
                stroke="#6b5344"
                strokeWidth="1.4"
                fill="none"
                strokeLinecap="round"
                strokeDasharray="3 4"
              />
            </g>
          </svg>
        </div>
      </div>

      {/* ---------------- controls ---------------- */}
      <div className="lab__controls">
        <fieldset className="step">
          <legend><b>01</b> What&apos;s the occasion?</legend>
          <div className="chips">
            {OCCASIONS.map((o) => (
              <button type="button" key={o} className="chip" aria-pressed={cfg.occasion === o} onClick={() => set("occasion", o)}>
                {o}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="step">
          <legend><b>02</b> How tall?</legend>
          <div className="tiers">
            {([1, 2, 3] as const).map((n) => (
              <button type="button" key={n} className="tierbtn" aria-pressed={cfg.tiers === n} onClick={() => set("tiers", n)}>
                <span className="tierbtn__ico" aria-hidden="true">
                  {Array.from({ length: n }, (_, i) => (
                    <i key={i} style={{ width: `${100 - i * 22}%` }} />
                  ))}
                </span>
                {n} tier{n > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="step">
          <legend><b>03</b> Sponge inside</legend>
          <div className="swatches">
            {(Object.keys(SPONGES) as SpongeId[]).map((s) => (
              <button type="button" key={s} className="swatch" aria-pressed={cfg.sponge === s} onClick={() => set("sponge", s)}>
                <span className="swatch__dot" style={{ background: `linear-gradient(180deg, ${SPONGES[s].c} 0 40%, #fff4e2 40% 52%, ${SPONGES[s].c} 52%)` }} />
                {SPONGES[s].label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="step">
          <legend><b>04</b> The finish</legend>
          <div className="swatches">
            {(Object.keys(FINISHES) as FinishId[]).map((f) => {
              const F = FINISHES[f];
              const body = f === "naked" ? sponge.c : F.body;
              return (
                <button type="button" key={f} className="swatch" aria-pressed={cfg.finish === f} onClick={() => set("finish", f)}>
                  <span className="swatch__dot" style={{ background: F.drip ? `radial-gradient(circle at 30% 42%, ${F.drip} 0 18%, transparent 19%), radial-gradient(circle at 62% 50%, ${F.drip} 0 16%, transparent 17%), linear-gradient(${F.drip} 0 34%, ${body} 34%)` : f === "naked" ? `repeating-linear-gradient(180deg, ${body} 0 9px, #fff4e2 9px 12px)` : `linear-gradient(${F.top}, ${body})` }} />
                  {F.label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="step">
          <legend><b>05</b> Toppings <small>pick any</small></legend>
          <div className="chips">
            {(Object.keys(TOPPINGS) as ToppingId[]).map((t) => (
              <button type="button" key={t} className="chip chip--dot" aria-pressed={has(t)} onClick={() => toggle("toppings", t)} style={{ "--dot": TOPPINGS[t].dot } as CSSVars}>
                {TOPPINGS[t].label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="step">
          <legend><b>06</b> Dietary needs <small>optional</small></legend>
          <div className="chips">
            {(Object.keys(DIETS) as DietId[]).map((d) => (
              <button type="button" key={d} className="chip chip--dot" aria-pressed={cfg.diet.includes(d)} onClick={() => toggle("diet", d)} style={{ "--dot": DIETS[d].flag } as CSSVars}>
                {DIETS[d].label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="step">
          <legend><b>07</b> Write something on it</legend>
          <label className="msg">
            <span className="sr-only">Message on the cake</span>
            <input
              type="text"
              maxLength={26}
              value={cfg.message}
              placeholder="Happy Birthday, Amma!"
              onChange={(e) => set("message", e.target.value)}
            />
            <span className="msg__count">{cfg.message.length}/26</span>
          </label>
        </fieldset>

        <div className="ticket">
          <div className="ticket__head">
            <span>Order ticket</span>
            <span>Nº {ticketNo}</span>
          </div>
          <dl>
            <div><dt>Occasion</dt><dd>{cfg.occasion}</dd></div>
            <div><dt>Build</dt><dd>{cfg.tiers} tier{cfg.tiers > 1 ? "s" : ""} · {sponge.label} · {fin.label}</dd></div>
            <div><dt>On top</dt><dd>{cfg.toppings.length ? cfg.toppings.map((t) => TOPPINGS[t].label).join(", ") : "Keep it simple"}</dd></div>
            {cfg.diet.length > 0 && <div><dt>Diet</dt><dd>{cfg.diet.map((d) => DIETS[d].label).join(", ")}</dd></div>}
            {msg && <div><dt>Piped</dt><dd>&ldquo;{msg}&rdquo;</dd></div>}
          </dl>
          <div className="ticket__actions">
            <a className="btn btn--cherry" href={wa} target="_blank" rel="noopener noreferrer" data-magnetic="0.2">
              <WhatsApp /> Send to the chef
            </a>
            <button type="button" className="btn btn--ghost" onClick={surprise}>
              Surprise me
            </button>
          </div>
          <p className="ticket__fine">
            Opens WhatsApp with your design filled in. Prefer talking? <a href="tel:+918056895352"><Phone size={13} /> 80568 95352</a>
          </p>
        </div>
      </div>
    </div>
  );
}
