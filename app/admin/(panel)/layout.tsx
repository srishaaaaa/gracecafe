import { redirect } from "next/navigation";
import { getRole } from "@/lib/auth";
import { adminState } from "@/lib/ops";
import { AdminProvider } from "../_ui/Store";
import Shell from "../_ui/Shell";

/* Everything behind the sign-in: one data store + the sidebar shell. */
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const role = await getRole();
  if (!role) redirect("/admin/login");
  const initial = await adminState();
  return (
    <AdminProvider initial={initial} role={role}>
      <Shell>{children}</Shell>
    </AdminProvider>
  );
}
