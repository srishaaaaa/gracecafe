import { isAuthed } from "@/lib/auth";
import { handle } from "@/lib/http";
import { adminState } from "@/lib/ops";
import { ApiError, currentVersion } from "@/lib/store";

/* GET ?since=<version> → {same:true} when nothing changed, else the full state.
   Admin AND staff see the same state — the sidebar and the server page guards
   decide what each one may do with it. */
export async function GET(req: Request) {
  return handle(async () => {
    if (!(await isAuthed())) throw new ApiError("Signed out.", 401);
    const since = Number(new URL(req.url).searchParams.get("since"));
    if (since && (await currentVersion()) === since) return { same: true };
    return adminState();
  });
}
