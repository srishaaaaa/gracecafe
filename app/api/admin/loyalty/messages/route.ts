import { isAuthed } from "@/lib/auth";
import { handle } from "@/lib/http";
import { messagesFor } from "@/lib/loyalty/server";
import { ApiError } from "@/lib/store";

/* GET ?billId= or ?customerId= → the WhatsApp messages prepared for that bill or customer. */
export async function GET(req: Request) {
  return handle(async () => {
    if (!(await isAuthed())) throw new ApiError("Signed out.", 401);
    return messagesFor(new URL(req.url).searchParams);
  });
}
