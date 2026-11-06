import type { Metadata } from "next";
import { Lexend } from "next/font/google";
import "./admin.css";

const lexend = Lexend({ subsets: ["latin"], variable: "--font-adm-num" });

export const metadata: Metadata = {
  title: { default: "Admin · Grace cafe", template: "%s · Admin · Grace cafe" },
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <div className={`adm ${lexend.variable}`}>{children}</div>;
}
