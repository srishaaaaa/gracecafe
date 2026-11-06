import { isAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { stockLedger } from "@/lib/ops";
import { ApiError } from "@/lib/store";

/* GET ?from&to&type&pid&q&page&size → one page of the stock ledger + period totals. */
export async function GET(req: Request) {
  return handle(async () => {
    if (!(await isAdmin())) throw new ApiError("Signed out.", 401);
    return stockLedger(new URL(req.url).searchParams);
  });
}
