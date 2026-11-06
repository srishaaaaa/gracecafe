import { requireAdmin } from "@/lib/auth";
import StockMovementsPage from "../../../_ui/StockMovementsPage";

export const metadata = { title: "Stock movement" };

export default async function Page() {
  await requireAdmin("/admin/billing");
  return <StockMovementsPage />;
}
