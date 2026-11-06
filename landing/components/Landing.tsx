import { Suspense } from "react";
import FX from "./FX";
import MenuIndex from "./MenuIndex";
import { Split, Letters, Roll, Drip, Barcode, Arrow, WhatsApp, Phone, Insta, Mail } from "@/app/_components/bits";

type CSSVars = React.CSSProperties & Record<`--${string}`, string | number>;
const U = (id: string, w = 700) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

const PHONE = "9042001476";
const PHONE_SHOWN = "90420 01476";
const EMAIL = "gracecafevalliyur@gmail.com";
const INSTA = "grace_cafe_valliyur";
const ADDR1 = "New, 792, Main Rd";
const ADDR2 = "Valliyur, Tamil Nadu — 627117";
const MAPS = "https://www.google.com/maps/search/?api=1&query=Grace+Cafe+792+Main+Rd+Valliyur+Tamil+Nadu+627117";
const LOGO = "/logo.png";

const TICKER = ["Freshly brewed", "Feel the grace", "Made with love", "Coffee · Bites · Desserts", "Valliyur"];

const GALLERY = [
  { img: U("1495474472287-4d71bcdd2085"), cap: "Golden hour coffee", tall: true },
  { img: U("1509042239860-f550ce710b93"), cap: "Latte art" },
  { img: U("1442512595331-e89e73853f31"), cap: "Cosy corners", tall: true },
  { img: U("1514432324607-a09d9b4aefdd"), cap: "Heart in the cup" },
  { img: U("1554118811-1e0d58224f24"), cap: "Come sit awhile", tall: true },
  { img: U("1447933601403-0c6688de566e"), cap: "Fresh brew" },
];

const STORY =
  "Grace Cafe is a little place in Valliyur made for slowing down. Every cup is made fresh, every plate is served with care, and every guest is treated like family. Come for the coffee, stay for the feeling — feel the grace.";

/** The Grace Cafe landing page (parked — see README.md). */
export default function Landing() {
  const storyWords = STORY.split(" ");
  return (
    <>
      <noscript>
        <style>{`[data-reveal]{opacity:1!important;transform:none!important;clip-path:none!important}.sw>span,.ltr>i,.drip__d,.kicker::before{transform:none!important}.story__read span{opacity:1!important}.fab{translate:none!important;opacity:1!important;pointer-events:auto!important}`}</style>
      </noscript>

      <FX />

      <div className="loader" aria-hidden="true">
        <div className="loader__inner">
          <svg className="loader__word" viewBox="0 0 600 140">
            <text x="300" y="100" textAnchor="middle">Grace Cafe</text>
          </svg>
          <div className="loader__oven">
            <span>Brewing</span>
            <b className="loader__temp" />
          </div>
        </div>
        <div className="loader__drip">
          <Drip color="#0d0d0d" seed={3} />
        </div>
      </div>

      <header className="nav" data-nav>
        <a href="#top" className="brand" aria-label="Grace Cafe — home">
          <img src={LOGO} alt="" style={{ height: 34, width: "auto" }} />
          <span className="brand__name">
            <em>Grace Cafe</em>
            <small>Feel the grace · Valliyur</small>
          </span>
        </a>
        <nav className="nav__links" aria-label="Main">
          <a href="#menu"><Roll>Menu</Roll></a>
          <a href="#story"><Roll>Story</Roll></a>
          <a href="#gallery"><Roll>Gallery</Roll></a>
          <a href="#visit"><Roll>Visit</Roll></a>
        </nav>
        <div className="nav__right">
          <a href={`tel:+91${PHONE}`} className="nav__call" aria-label={`Call ${PHONE_SHOWN}`}>
            <Phone size={16} /> <span>{PHONE_SHOWN}</span>
          </a>
          <a href="#menu" className="btn btn--cherry btn--sm" data-magnetic="0.25">View menu</a>
          <button type="button" className="burger" data-menu-toggle aria-expanded="false" aria-controls="mobile-menu" aria-label="Menu">
            <span />
            <span />
          </button>
        </div>
      </header>

      <div className="mmenu" id="mobile-menu">
        <nav aria-label="Mobile">
          {[["#menu", "Menu"], ["#story", "Our story"], ["#gallery", "Gallery"], ["#visit", "Visit us"]].map(([href, label], i) => (
            <a key={href} href={href} data-menu-link style={{ "--i": i } as CSSVars}>
              <span>0{i + 1}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className="mmenu__foot">
          <a href={`tel:+91${PHONE}`}>+91 {PHONE_SHOWN}</a>
          <a href={`https://instagram.com/${INSTA}`} target="_blank" rel="noopener noreferrer">@{INSTA}</a>
        </div>
      </div>

      <main>
        {/* ===================== COVER ===================== */}
        <section className="cover" id="top" data-live>
          <div className="cover__pin" style={{ display: "grid", placeItems: "center", textAlign: "center", gap: 18 }}>
            <h1 className="sr-only">Grace Cafe — Feel the grace. Valliyur, Tamil Nadu</h1>
            <img src={LOGO} alt="Grace Cafe — Feel the grace" style={{ width: "min(70vw, 460px)", height: "auto" }} />
            <p className="cover__after" style={{ position: "static" }}>
              Feel the <em>grace.</em>
            </p>
            <div className="visit__cta" style={{ justifyContent: "center" }}>
              <a className="btn btn--cherry" href="#menu" data-magnetic="0.25">See the menu <Arrow /></a>
              <a className="btn btn--cream" href={MAPS} target="_blank" rel="noopener noreferrer" data-magnetic="0.25">Get directions <Arrow /></a>
            </div>
            <a href={`tel:+91${PHONE}`} className="barcode" aria-label={`Call +91 ${PHONE_SHOWN}`}>
              <Barcode digits={`91${PHONE}`} />
              <span>+91 {PHONE_SHOWN}</span>
            </a>
          </div>
        </section>

        <div className="ribbons" aria-hidden="true" data-live>
          <div className="ribbon ribbon--a" data-marquee="1">
            <div className="ribbon__track">
              {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map((t, i) => (
                <span key={i}>{t} <i>✺</i></span>
              ))}
            </div>
          </div>
          <div className="ribbon ribbon--b" data-marquee="-1">
            <div className="ribbon__track">
              {[...TICKER, ...TICKER, ...TICKER, ...TICKER].reverse().map((t, i) => (
                <span key={i}>{t} <i>✺</i></span>
              ))}
            </div>
          </div>
        </div>

        {/* ===================== 01 MENU ===================== */}
        <section className="sec menu" id="menu">
          <div className="wrap">
            <header className="head">
              <span className="kicker" data-reveal="fade">(01) The Menu</span>
              <h2 className="h-xl" data-reveal="split">
                <Split text="What are you" /> <em><Split text="craving?" from={3} /></em>
              </h2>
              <p className="lede" data-reveal="up" style={{ "--i": 2 } as CSSVars}>
                A taste of what we serve. Ask at the counter or message us on WhatsApp for the full menu.
              </p>
            </header>
            <Suspense>
              <MenuIndex />
            </Suspense>
          </div>
        </section>

        {/* ===================== 02 STORY ===================== */}
        <section className="sec story scallop" id="story" data-live>
          <div className="wrap">
            <div className="story__grid">
              <div className="story__head">
                <span className="kicker" data-reveal="fade">(02) Our Story</span>
                <h2 className="h-xl" data-reveal="split">
                  <Split text="Made with" /> <em><Split text="grace," from={2} /></em> <Split text="served with love." from={3} />
                </h2>
                <p className="story__sig" data-reveal="fade">— S. Rajan, Grace Cafe</p>
              </div>
              <p className="story__read" data-progress="read" style={{ "--n": storyWords.length } as CSSVars}>
                {storyWords.map((w, i) => (
                  <span key={i} style={{ "--i": i } as CSSVars}>{w}{" "}</span>
                ))}
              </p>
            </div>
          </div>
          <Drip color="#0d0d0d" seed={11} />
        </section>

        {/* ===================== 03 GALLERY ===================== */}
        <section className="gal" id="gallery" data-hscroll data-live>
          <div className="gal__pin">
            <div className="gal__bgword" aria-hidden="true">feel the grace · feel the grace ·</div>
            <div className="gal__track" data-htrack>
              <div className="gal__intro">
                <span className="kicker">(03) Gallery</span>
                <h2 className="h-xl">A peek <em>inside</em>.</h2>
                <p className="lede">Coffee, corners and good company. Follow us on Instagram for more.</p>
                <span className="gal__arrow" aria-hidden="true">keep scrolling <i><Arrow /></i></span>
              </div>
              {GALLERY.map((g, i) => (
                <figure key={g.img} className={`gal__item ${g.tall ? "is-tall" : ""}`} style={{ "--r": `${i % 2 ? 2 : -2}deg` } as CSSVars} data-cursor="Love it">
                  <div className="gal__img">
                    <img src={g.img} alt={g.cap} loading="lazy" decoding="async" />
                  </div>
                  <figcaption><span>{String(i + 1).padStart(2, "0")}</span> {g.cap}</figcaption>
                </figure>
              ))}
              <a className="gal__end" href={`https://instagram.com/${INSTA}`} target="_blank" rel="noopener noreferrer" data-cursor="Follow">
                <Insta size={34} />
                <span>More on Instagram</span>
                <b>@{INSTA}</b>
              </a>
            </div>
          </div>
        </section>

        {/* ===================== 04 VISIT ===================== */}
        <section className="sec visit scallop" id="visit">
          <div className="wrap">
            <header className="head">
              <span className="kicker" data-reveal="fade">(04) Visit</span>
              <h2 className="h-xl" data-reveal="split">
                <Split text="Come on" /> <em><Split text="in." from={2} /></em>
              </h2>
              <p className="lede" data-reveal="up" style={{ "--i": 2 } as CSSVars}>
                Find us on Main Road, Valliyur — or message us and we&apos;ll save you a table.
              </p>
            </header>

            <div className="visit__grid">
              <div className="printer">
                <div className="printer__slot" aria-hidden="true" />
                <div className="receipt" data-reveal="print">
                  <div className="receipt__head">
                    <img src={LOGO} alt="" style={{ height: 54, width: "auto" }} />
                    <b>GRACE CAFE</b>
                    <span>{ADDR1}</span>
                    <span>{ADDR2}</span>
                  </div>
                  <div className="receipt__rule" />
                  <dl className="receipt__rows">
                    <div><dt>Call / WhatsApp</dt><dd><a href={`tel:+91${PHONE}`}>+91 {PHONE_SHOWN}</a></dd></div>
                    <div><dt>Email</dt><dd><a href={`mailto:${EMAIL}`}>{EMAIL}</a></dd></div>
                    <div><dt>Instagram</dt><dd><a href={`https://instagram.com/${INSTA}`} target="_blank" rel="noopener noreferrer">@{INSTA}</a></dd></div>
                    <div><dt>Owner</dt><dd>S. Rajan</dd></div>
                  </dl>
                  <div className="receipt__rule" />
                  <dl className="receipt__rows receipt__items">
                    <div><dt>1 × Fresh coffee</dt><dd>made for you</dd></div>
                    <div><dt>1 × Good company</dt><dd>yours</dd></div>
                    <div><dt>Grace</dt><dd>∞</dd></div>
                  </dl>
                  <div className="receipt__rule receipt__rule--bold" />
                  <div className="receipt__total"><span>TOTAL</span><span>one big smile</span></div>
                  <div className="receipt__code"><Barcode digits={PHONE} /></div>
                  <p className="receipt__thanks">✺ thank you — come again ✺</p>
                </div>
              </div>

              <div className="visit__right">
                <div className="stampwrap" data-reveal="scale">
                  <div className="stamp">
                    <iframe
                      title="Grace Cafe location — Main Rd, Valliyur"
                      src="https://www.google.com/maps?q=Grace+Cafe+792+Main+Rd+Valliyur+Tamil+Nadu+627117&output=embed"
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
                </div>
                <div className="visit__cta">
                  <a className="btn btn--cherry" href={`https://wa.me/91${PHONE}`} target="_blank" rel="noopener noreferrer" data-magnetic="0.25">
                    <WhatsApp /> Chat on WhatsApp
                  </a>
                  <a className="btn btn--cream" href={MAPS} target="_blank" rel="noopener noreferrer" data-magnetic="0.25">
                    Get directions <Arrow />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot" data-live>
        <div className="wrap">
          <div className="foot__top">
            <p className="foot__lead" data-reveal="split">
              <Split text="Feel the" /> <em><Split text="grace." from={2} /></em>
            </p>
            <div className="foot__links">
              <div>
                <h5>Explore</h5>
                <a href="#menu"><Roll>The Menu</Roll></a>
                <a href="#story"><Roll>Our Story</Roll></a>
                <a href="#visit"><Roll>Visit</Roll></a>
              </div>
              <div>
                <h5>Say hello</h5>
                <a href={`tel:+91${PHONE}`}><Phone size={14} /> +91 {PHONE_SHOWN}</a>
                <a href={`mailto:${EMAIL}`}><Mail size={14} /> {EMAIL}</a>
                <a href={`https://instagram.com/${INSTA}`} target="_blank" rel="noopener noreferrer"><Insta size={14} /> @{INSTA}</a>
              </div>
            </div>
          </div>
        </div>

        <div className="foot__word" data-reveal="split" aria-hidden="true">
          <Letters text="Grace Cafe" />
        </div>

        <div className="foot__base">
          <span>© 2026 Grace Cafe</span>
          <span>{ADDR1}, {ADDR2}</span>
        </div>
      </footer>

      <a className="fab is-away" data-fab href={`https://wa.me/91${PHONE}`} target="_blank" rel="noopener noreferrer" aria-label="Message us on WhatsApp" data-magnetic="0.3">
        <WhatsApp size={22} />
        <span>Chat</span>
      </a>
      <button type="button" className="totop" data-toprogress aria-label="Back to top">
        <svg viewBox="0 0 44 44" aria-hidden="true">
          <circle cx="22" cy="22" r="20" />
          <circle cx="22" cy="22" r="20" className="totop__bar" pathLength={1} />
        </svg>
        <span aria-hidden="true">↑</span>
      </button>
    </>
  );
}
