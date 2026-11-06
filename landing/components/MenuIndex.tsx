"use client";

import { useEffect, useRef, useState } from "react";
import { Arrow } from "@/app/_components/bits";

const U = (id: string, w = 520) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export const MENU = [
  { title: "Hot Coffee", note: "Fresh, strong and made to order.", img: U("1495474472287-4d71bcdd2085") },
  { title: "Cold Coffee", note: "Chilled, creamy and just sweet enough.", img: U("1461023058943-07fcbe16d735") },
  { title: "Latte & Cappuccino", note: "Smooth milk, a little art on top.", img: U("1514432324607-a09d9b4aefdd") },
  { title: "Snacks & Bites", note: "Something warm to go with your cup.", img: U("1509042239860-f550ce710b93") },
  { title: "Desserts", note: "A sweet finish, every time.", img: U("1442512595331-e89e73853f31") },
];

export default function MenuIndex() {
  const [active, setActive] = useState<number | null>(null);
  const floatRef = useRef<HTMLDivElement>(null);

  // floating preview follows the pointer and leans with its velocity
  useEffect(() => {
    const el = floatRef.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0, first = true;
    const loop = () => {
      raf = 0;
      const px = x;
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      const rot = Math.max(-16, Math.min(16, (x - px) * 0.6));
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg)`;
      if (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3) raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (first) {
        x = tx;
        y = ty;
        first = false;
      }
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const list = el.parentElement!;
    list.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      list.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="mindex" onPointerLeave={() => setActive(null)}>
      <ol>
        {MENU.map((m, i) => (
          <li key={m.title} data-reveal="up" style={{ "--i": i } as React.CSSProperties}>
            <a
              href="#visit"
              className={`mi ${active === i ? "is-on" : ""}`}
              data-cursor="Order"
              onPointerEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
            >
              <span className="mi__n">{String(i + 1).padStart(2, "0")}</span>
              <span className="mi__t">
                {Array.from(m.title).map((ch, j) => (
                  <span key={j} style={{ "--j": j } as React.CSSProperties}>
                    {ch === " " ? " " : ch}
                  </span>
                ))}
              </span>
              <span className="mi__note">{m.note}</span>
              <img className="mi__thumb" src={m.img.replace("w=520", "w=200")} alt="" loading="lazy" decoding="async" />
              <span className="mi__go">
                <Arrow size={22} />
              </span>
            </a>
          </li>
        ))}
      </ol>

      <div className={`mfloat ${active !== null ? "is-on" : ""}`} ref={floatRef} aria-hidden="true">
        <div className="mfloat__card">
          {MENU.map((m, i) => (
            <img key={m.title} src={m.img} alt="" className={active === i ? "is-on" : ""} loading="lazy" decoding="async" />
          ))}
          <span className="mfloat__tag">{active !== null ? MENU[active].title : ""}</span>
        </div>
      </div>
    </div>
  );
}
