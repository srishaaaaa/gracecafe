import { shopLogo } from "@/lib/ops";

/* The browser-tab icon: the logo from Settings. An uploaded logo is stored as a
   data URL, so it is decoded and served as an image; a pasted link is redirected
   to. With no logo set, the built-in sandwich icon is used. */

export const dynamic = "force-dynamic";

const FALLBACK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M4 14c0-6 5.4-10 12-10s12 4 12 10z" fill="#ffb81c"/><circle cx="11" cy="9" r="1" fill="#fff6e3"/><circle cx="16" cy="7" r="1" fill="#fff6e3"/><circle cx="21" cy="9.5" r="1" fill="#fff6e3"/><path d="M3 16.5c3 1.6 4 1.6 6.5 0s4 1.6 6.5 1.6 4-3.2 6.5-1.6 3.5 1.6 6.5 0v1.5H3z" fill="#7bc043"/><rect x="4" y="19" width="24" height="3.5" rx="1.75" fill="#6b7550"/><path d="M4 23.5h24v1.5a3.5 3.5 0 0 1-3.5 3.5h-17A3.5 3.5 0 0 1 4 25z" fill="#ffb81c"/></svg>`;

// short cache, so a new logo shows up in the tab within a few minutes
const CACHE = "public, max-age=300, stale-while-revalidate=3600";

export async function GET(req: Request) {
  const logo = await shopLogo().catch(() => "");
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(logo);
  if (m) return new Response(Buffer.from(m[2], "base64"), { headers: { "Content-Type": m[1], "Cache-Control": CACHE } });
  if (/^https?:\/\//i.test(logo)) return Response.redirect(logo, 302);
  void FALLBACK; // the built-in picture is now the 8:2 logo
  return Response.redirect(new URL("/logo.png", req.url), 302);
}
