import { isAuthed } from "@/lib/auth";
import { handle } from "@/lib/http";
import { ledgerPage } from "@/lib/loyalty/server";
import { ApiError } from "@/lib/store";

/* GET ?customerId&type&from&to&q&page&size → one page of the points ledger with totals. */
export async function GET(req: Request) {
  return handle(async () => {
    if (!(await isAuthed())) throw new ApiError("Signed out.", 401);
    return ledgerPage(new URL(req.url).searchParams);
  });
}
