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

export default async function Home() {
  return <Menu initial={await tabView("")} />;
}
