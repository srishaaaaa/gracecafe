import { isAuthed } from "@/lib/auth";
import { handle } from "@/lib/http";
import { lookup } from "@/lib/loyalty/server";
import { ApiError } from "@/lib/store";

/* GET ?phone → the member (if any), their points, rewards and offers — for Billing. */
export async function GET(req: Request) {
  return handle(async () => {
    if (!(await isAuthed())) throw new ApiError("Signed out.", 401);
    return lookup(new URL(req.url).searchParams.get("phone"));
  });
}
