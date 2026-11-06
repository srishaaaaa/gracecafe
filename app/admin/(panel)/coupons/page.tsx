import { requireAdmin } from "@/lib/auth";
import CouponsPage from "../../_ui/CouponsPage";

export const metadata = { title: "Coupons" };

export default async function Page() {
  await requireAdmin("/admin/billing");
  return <CouponsPage />;
}
