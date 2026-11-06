"use client";

import { useEffect, useRef, useState } from "react";

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;

const SLICES = [
  {
    name: "Vegan",
    color: "#b3c68b",
    rim: "#e9f0d6",
    deco: "mint",
    line: "No eggs. No dairy. No one at the table will guess.",
    body: "Plant-based sponges and frostings, baked to the same recipe standards as our classics — so the vegan slice is never the sad slice.",
  },
  {
    name: "Gluten-free",
    color: "#e2a75c",
    rim: "#f7e2c0",
    deco: "cherry",
    line: "All of the cake. None of the wheat.",
    body: "Made without wheat flour and baked with care, so celebrations with gluten-free guests don't need a separate, lesser dessert.",
  },
  {
    name: "Sugar-free",
    color: "#f5ecdc",
    rim: "#fffaf0",
    deco: "berries",
    line: "Sweet on the tongue, gentle on the numbers.",
    body: "Sweetness dialled in thoughtfully for anyone watching their sugar — still frosted, still finished, still a proper cake.",
  },
  {
    name: "Dairy-free",
    color: "#5a3120",
    rim: "#8a5a3c",
    deco: "choc",
    line: "Creamy without the cream. Rich without the butter.",
    body: "Glossy, indulgent and entirely milk-free. Tell us about any allergies when you order and we'll plan around them.",
  },
];

const C = 180;
const R = 150;

function slicePath(center: number) {
  const a0 = ((center - 45) * Math.PI) / 180;
  const a1 = ((center + 45) * Math.PI) / 180;
  return `M${C} ${C} L${C + R * Math.cos(a0)} ${C + R * Math.sin(a0)} A${R} ${R} 0 0 1 ${C + R * Math.cos(a1)} ${C + R * Math.sin(a1)}Z`;
}
const pt = (deg: number, r: number) => ({ x: C + r * Math.cos((deg * Math.PI) / 180), y: C + r * Math.sin((deg * Math.PI) / 180) });

export default function SliceWheel() {
  const [active, setActive] = useState(0);
  const [rot, setRot] = useState(0);
  const [auto, setAuto] = useState(true);
  const rotRef = useRef(0);
  const activeRef = useRef(0);

  const choose = (i: number) => {
    const target = -i * 90;
    let delta = (target - rotRef.current) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    rotRef.current += delta;
    setRot(rotRef.current);
    activeRef.current = i;
    setActive(i);
  };

  // auto-rotate only while the wheel is actually on screen
  const [inView, setInView] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!auto || !inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => choose((activeRef.current + 1) % SLICES.length), 3800);
    return () => window.clearInterval(t);
  }, [auto, inView]);

  const pick = (i: number) => {
    setAuto(false);
    choose(i);
  };

  const s = SLICES[active];

  return (
    <div className="wheel" ref={wrapRef}>
      <div className="wheel__art" data-reveal="scale">
        <div className="wheel__disc">
        {/* static plate + shadow */}
        <svg viewBox="-30 -30 420 420" className="wheel__svg" aria-hidden="true">
          <circle cx={C} cy={C + 10} r={R + 26} fill="#000" opacity=".18" />
          <circle cx={C} cy={C} r={R + 26} fill="#fbf5ea" />
          <circle cx={C} cy={C} r={R + 16} fill="none" stroke="#26170f" strokeOpacity=".08" strokeWidth="2" />
          <circle cx={C} cy={C} r={R + 21} fill="none" stroke="#26170f" strokeOpacity=".08" strokeDasharray="1 6" />
        </svg>
        {/* the cake turns on an HTML layer so the GPU does the rotation */}
        <div className="wheel__spin" style={{ transform: `rotate(${rot}deg)` }}>
        <svg viewBox="-30 -30 420 420" className="wheel__svg" aria-hidden="true">
          <g>
            {SLICES.map((sl, i) => {
              const mid = i * 90;
              const on = active === i;
              const d = pt(mid, 26);
              return (
                <g
                  key={sl.name}
                  className={`slice ${on ? "is-on" : ""}`}
                  style={{ "--tx": `${d.x - C}px`, "--ty": `${d.y - C}px` } as CSSVars}
                  onClick={() => pick(i)}
                >
                  <path d={slicePath(mid)} fill={sl.color} stroke="#26170f" strokeOpacity=".18" strokeWidth="1.5" />
                  {/* inner shading toward the centre */}
                  <path d={slicePath(mid)} fill="url(#sliceShade)" />
                  {/* piped rim */}
                  {Array.from({ length: 7 }, (_, k) => {
                    const p = pt(mid - 38 + k * 12.7, R - 13);
                    return <circle key={k} cx={p.x} cy={p.y} r={9} fill={sl.rim} stroke="#26170f" strokeOpacity=".08" />;
                  })}
                  {/* centre decoration */}
                  {(() => {
                    const p = pt(mid, R * 0.52);
                    if (sl.deco === "cherry")
                      return (
                        <g>
                          <path d={`M${p.x} ${p.y - 6} q4 -14 14 -16`} stroke="#4a3212" strokeWidth="2" fill="none" />
                          <circle cx={p.x} cy={p.y} r={11} fill="#c8102e" />
                          <circle cx={p.x - 4} cy={p.y - 4} r={3} fill="#fff" opacity=".55" />
                        </g>
                      );
                    if (sl.deco === "mint")
                      return (
                        <g transform={`translate(${p.x - 14} ${p.y}) rotate(${mid - 30})`}>
                          <path d="M0 0 C8 -11 22 -11 30 0 C22 8 8 8 0 0Z" fill="#6f9448" />
                          <path d="M2 0 H27" stroke="#4f7030" strokeWidth="1.2" />
                        </g>
                      );
                    if (sl.deco === "berries")
                      return (
                        <g>
                          <circle cx={p.x - 8} cy={p.y + 3} r={8} fill="#d62c4a" />
                          <circle cx={p.x + 8} cy={p.y - 2} r={7} fill="#3d4a86" />
                          <circle cx={p.x + 2} cy={p.y + 11} r={6} fill="#3d4a86" />
                        </g>
                      );
                    return (
                      <g transform={`rotate(${mid + 20} ${p.x} ${p.y})`}>
                        <rect x={p.x - 13} y={p.y - 9} width={26} height={18} rx={2} fill="#2e160c" />
                        <path d={`M${p.x} ${p.y - 9} V${p.y + 9} M${p.x - 13} ${p.y} H${p.x + 13}`} stroke="#4d2819" strokeWidth="1.5" />
                      </g>
                    );
                  })()}
                </g>
              );
            })}
          </g>
          <defs>
            <radialGradient id="sliceShade" cx={C} cy={C} r={R} gradientUnits="userSpaceOnUse">
              <stop offset=".1" stopColor="#000" stopOpacity=".16" />
              <stop offset=".6" stopColor="#000" stopOpacity="0" />
            </radialGradient>
          </defs>
        </svg>
        </div>
        </div>
        <span className="wheel__hint">tap a slice</span>
      </div>

      <div className="wheel__panel" data-reveal="up">
        <div className="wheel__tabs" role="tablist" aria-label="Dietary ranges">
          {SLICES.map((sl, i) => (
            <button
              key={sl.name}
              type="button"
              role="tab"
              aria-selected={active === i}
              className="wheel__tab"
              onClick={() => pick(i)}
              style={{ "--sw": sl.color } as CSSVars}
            >
              {sl.name}
            </button>
          ))}
        </div>
        <div className="wheel__copy" key={active} role="tabpanel">
          <span className="wheel__count">0{active + 1} / 04 · range</span>
          <h3>{s.name}</h3>
          <p className="wheel__line">{s.line}</p>
          <p>{s.body}</p>
        </div>
      </div>
    </div>
  );
}
