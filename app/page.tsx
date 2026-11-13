import type { Metadata } from "next";
import Menu from "./_components/Menu";
import { shopName, tabView } from "@/lib/ops";
import "./menu.css";

/* The one front door — the shop's QR code and link point here. Guests browse the
   menu, then leave a name and mobile with their first order; from then on their
   tab is found by that mobile. */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: `Order | ${await shopName()}`, robots: { index: false } };
}

export default async function Home({ searchParams }: PageProps<"/">) {
  /* A table's QR carries its number: /?table=5. It rides along with every order from that phone. */
  const t = (await searchParams).table;
  const table = (Array.isArray(t) ? t[0] : t ?? "").replace(/[^A-Za-z0-9 -]/g, "").trim().slice(0, 12);
  return <Menu initial={await tabView("")} table={table} />;
}
