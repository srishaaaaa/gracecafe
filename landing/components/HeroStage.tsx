"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import piecesData from "../pieces.json";

type Piece = {
  file: string;
  role: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  area: number;
  r: number;
  g: number;
  b: number;
  fill: number;
};
type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;

const pieces = piecesData as Piece[];
const SRC_W = 2752;
const SRC_H = 1536;
const ASPECT = SRC_H / SRC_W;
/* how wide the stage is drawn, as a multiple of the viewport width, on phones
   and on desktop — only used to tell the image optimiser which size to send */
const STAGE_VW_PHONE = 265;
const STAGE_VW_DESK = 110;
/* crumbs under this area are specks on a phone: dropped there (see .is-crumb) */
const CRUMB_AREA = 9000;

type Kind = "mint" | "berry" | "cream" | "swirl" | "choc";

function classify(p: Piece): Kind {
  const { r, g, b, fill } = p;
  if (g > r + 6 && g > b + 16) return "mint";
  if (b > r + 4 && b > g + 4) return "berry";
  if (r > 150 && g < r - 45 && b < r - 25) return "berry";
  if (r > 178 && g > 150 && b > 140) return "cream";
  if (fill < 0.3) return "swirl";
  return "choc";
}

const AMP: Record<Kind, number> = { choc: 34, berry: 22, mint: 16, cream: 10, swirl: 0 };
const DEPTH: Record<Kind, number> = { choc: 52, berry: 42, mint: 36, cream: 24, swirl: 14 };

/* floating sprinkles across the stage, in the site palette */
const SPRINKLES: [number, number][] = [
  [12, 24], [22, 56], [34, 14], [41, 40], [28, 90], [55, 8],
  [67, 88], [72, 18], [80, 50], [88, 30], [92, 58], [63, 62],
];
const SPRINKLE_COLORS = ["#d7263d", "#f5ecdc", "#b3c68b", "#e2a75c", "#f2b8b5", "#8a5a3c"];

export default function HeroStage() {
  const cake = pieces.find((p) => p.role === "cake")!;
  const props = pieces.filter((p) => p.role !== "cake");
  const ref = useRef<HTMLDivElement>(null);

  // mouse parallax — writes --mx / --my, eased
  useEffect(() => {
    const stage = ref.current;
    if (!stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, visible = true;
    const onMove = (e: PointerEvent) => {
      tx = Math.max(-1.2, Math.min(1.2, (e.clientX / window.innerWidth - 0.5) * 2));
      ty = Math.max(-1.2, Math.min(1.2, (e.clientY / window.innerHeight - 0.5) * 2));
      if (!raf && visible) raf = requestAnimationFrame(loop);
    };
    // only runs while the pointer is still settling, and only while the hero is on screen
    const loop = () => {
      raf = 0;
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      stage.style.setProperty("--mx", cx.toFixed(4));
      stage.style.setProperty("--my", cy.toFixed(4));
      if (visible && (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001)) raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(stage);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="stage" ref={ref} aria-hidden="true">
      <div className="stage__rays" />
      <div className="stage__glow" />
      <div className="stage__shock" />

      {props.map((p, i) => {
        const type = classify(p);
        const back = type === "swirl" || (p.fill < 0.4 && p.area > 26000);
        const dx = p.cx - 0.5;
        const dy = p.cy - 0.5;
        const sign = i % 2 ? 1 : -1;
        // pieces the phone layout drops (see .is-edge / .is-crumb): lazy, so a
        // display:none piece never costs a phone the download
        const phoneOnly = p.cx < 0.27 || p.cx > 0.73 || p.area < CRUMB_AREA;
        const style: CSSVars = {
          "--cx": `${p.cx * 100}%`,
          "--cy": `${p.cy * 100}%`,
          "--w": `${p.w * 100}%`,
          "--depth": DEPTH[type],
          "--dur": `${type === "swirl" ? 22 + (i % 5) * 4 : 4 + (i % 7) * 0.7}s`,
          "--delay": `${-((i % 9) * 0.6)}s`,
          // vector from this piece back to the cake centre (in stage-width units)
          "--bx": ((cake.cx - p.cx) * 100).toFixed(2),
          "--by": ((cake.cy - p.cy) * 100 * ASPECT).toFixed(2),
          "--bi": i,
          "--spin": `${sign * (90 + (i % 5) * 50)}deg`,
        };
        return (
          <div
            key={p.file}
            className={`pc ${back ? "pc--back" : p.cy < 0.38 ? "pc--under" : "pc--front"} is-${type} ${p.cx < 0.27 || p.cx > 0.73 ? "is-edge" : ""} ${p.area < CRUMB_AREA ? "is-crumb" : ""} ${p.area < CRUMB_AREA && type !== "swirl" ? "is-still" : ""} drift-${dy < 0 ? "n" : "s"}${dx < 0 ? "w" : "e"}${AMP[type] > 20 ? "" : "-sm"}`}
            style={style}
          >
            <div className="pc__scroll">
              <div className="pc__burst">
                <div className="pc__anim">
                  {/* the optimiser sends a phone-sized WebP: these PNGs are ~10x
                      heavier than they need to be, and there are a lot of them.
                      The ones the phone layout hides load lazily — with no box
                      they are never fetched there at all. */}
                  <Image
                    src={p.file}
                    alt=""
                    width={Math.round(p.w * SRC_W)}
                    height={Math.round(p.h * SRC_H)}
                    sizes={`(max-width: 1100px) ${Math.ceil(p.w * STAGE_VW_PHONE)}vw, ${Math.ceil(p.w * STAGE_VW_DESK)}vw`}
                    loading={phoneOnly ? "lazy" : "eager"}
                    draggable={false}
                  />
                </div>
              </div>
            </div>
          </div>
        );
      })}

      <div
        className="pc pc--cake"
        style={{ "--cx": `${cake.cx * 100}%`, "--cy": `${cake.cy * 100}%`, "--w": `${cake.w * 129}%`, "--depth": 18 } as CSSVars}
      >
        <div className="cake-scroll">
          <div className="cake-drop">
            <div className="pc__px">
              <div className="cake-sway">
                <Image
                  className="cake-art"
                  src={cake.file}
                  alt=""
                  width={Math.round(cake.w * SRC_W)}
                  height={Math.round(cake.h * SRC_H)}
                  sizes={`(max-width: 1100px) ${Math.ceil(cake.w * 1.29 * STAGE_VW_PHONE)}vw, ${Math.ceil(cake.w * 1.29 * STAGE_VW_DESK)}vw`}
                  preload
                  draggable={false}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {SPRINKLES.map(([left, top], i) => {
        const star = i % 4 === 3;
        const size = star ? 7 : 5 + (i % 3) * 2;
        return (
          <div key={`s${i}`} className={left < 27 || left > 73 ? "spr is-edge" : "spr"} style={{ left: `${left}%`, top: `${top}%`, "--depth": 24 + (i % 5) * 10 } as CSSVars}>
            <span
              className={star ? "spr__i is-star" : "spr__i"}
              style={{
                width: star ? size : size * 2.6,
                height: size,
                rotate: `${(i * 47) % 180}deg`,
                background: star ? "#ffe2a8" : SPRINKLE_COLORS[i % SPRINKLE_COLORS.length],
                "--dur": `${3 + (i % 5) * 0.8}s`,
                "--delay": `${-(i % 6) * 0.7}s`,
              } as CSSVars}
            />
          </div>
        );
      })}
    </div>
  );
}
