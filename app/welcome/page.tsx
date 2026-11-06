import type { Metadata } from "next";
import Landing from "@/landing/components/Landing";
import "@/landing/landing.css";

/* The Grace Cafe welcome page — a separate address from "/", which stays the ordering menu. */
export const metadata: Metadata = {
  title: "Grace Cafe | Feel the grace — Valliyur",
  description: "Coffee, tea, pastries and more at Grace Cafe, Main Rd, Valliyur.",
};

export default function Welcome() {
  return <Landing />;
}
