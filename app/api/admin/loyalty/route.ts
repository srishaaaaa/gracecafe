import { isAuthed } from "@/lib/auth";
import { handle } from "@/lib/http";
import { loyaltyState } from "@/lib/loyalty/server";
import { ApiError } from "@/lib/store";

/* GET → everything the Loyalty page shows (members, rewards, campaigns, totals, audit). */
export async function GET() {
  return handle(async () => {
    if (!(await isAuthed())) throw new ApiError("Signed out.", 401);
    return loyaltyState();
  });
}
