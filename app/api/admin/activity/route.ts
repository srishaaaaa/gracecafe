import { isAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { activityPage } from "@/lib/ops";
import { ApiError } from "@/lib/store";

/* GET → the latest changes made in the admin console, newest first (admin only). */
export async function GET() {
  return handle(async () => {
    if (!(await isAdmin())) throw new ApiError("Signed out.", 401);
    return { rows: await activityPage() };
  });
}
