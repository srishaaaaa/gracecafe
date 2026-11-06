import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Caveat, Cinzel } from "next/font/google";
import "./globals.css";

const fraunces = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

/* The wordmark's western face — used only for the shop name beside the logo, not for the rest of the app. */
const brand = Cinzel({
  variable: "--font-brand",
  subsets: ["latin"],
  weight: ["500", "700"],
});

const instrument = Instrument_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const caveat = Caveat({
  variable: "--font-hand",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Grace cafe | Valliyur",
  description: "Order from your phone at Grace cafe — browse the menu, add to your tab and pay at the counter.",
  robots: { index: false, follow: false },
  // the Grace cafe logo (public/icon.png)
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#0d0d0d",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable} ${caveat.variable} ${brand.variable} antialiased`}
    >
      <body>{children}</body>
    </html>
  );
}
