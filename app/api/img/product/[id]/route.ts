import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { products } from "@/lib/db/schema";

/* An uploaded product picture, decoded from the data URL it is stored as. The link carries
   ?v=<updatedAt>, so a given link never changes and the browser can keep it for good. */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [row] = await db.select({ image: products.image }).from(products).where(eq(products.id, id));
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(row?.image ?? "");
  if (!m) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(m[2], "base64"), { headers: { "Content-Type": m[1], "Cache-Control": "public, max-age=31536000, immutable" } });
}
