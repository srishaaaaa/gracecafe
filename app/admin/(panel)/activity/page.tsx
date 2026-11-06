import { requireAdmin } from "@/lib/auth";
import ActivityPage from "../../_ui/ActivityPage";

export const metadata = { title: "Activity log" };

export default async function Page() {
  await requireAdmin("/admin/billing");
  return <ActivityPage />;
}
