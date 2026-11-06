import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { shopLogo } from "@/lib/ops";
import LoginForm from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await isAdmin()) redirect("/admin");
  const logo = await shopLogo().catch(() => "");
  return <LoginForm logo={logo ? "/shop-logo" : ""} />;
}
