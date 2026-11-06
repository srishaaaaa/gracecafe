import { requireAdmin } from "@/lib/auth";
import ExpensesPage from "../../_ui/ExpensesPage";

export const metadata = { title: "Expenses" };

export default async function Page() {
  await requireAdmin("/admin/billing");
  return <ExpensesPage />;
}
