import { isAuthed } from "@/lib/auth";
import { handle } from "@/lib/http";
import { ordersPage } from "@/lib/ops";
import { ApiError } from "@/lib/store";

/* GET ?type&pay&from&to&q&offset&size → one page of bills for Order Management + payment-method totals.
   Admin and staff both see Orders. */
export async function GET(req: Request) {
  return handle(async () => {
    if (!(await isAuthed())) throw new ApiError("Signed out.", 401);
    return ordersPage(new URL(req.url).searchParams);
  });
}
