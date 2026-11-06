import { config } from "dotenv";
config({ path: ".env.local" });

/* npm run db:seed — fills an empty database with the menu and a sample
   coupon. Safe to re-run: it only inserts rows that are missing. */

async function main() {
  const { db } = await import("../lib/db");
  const { coupons, meta, products, settings } = await import("../lib/db/schema");
  const { seedData } = await import("../lib/seed");
  const d = seedData();
  await db.insert(meta).values({ id: 1 }).onConflictDoNothing();
  await db.insert(settings).values({ id: 1, shopName: d.shopName, publicUrl: "" }).onConflictDoNothing();
  await db.insert(products).values(d.products).onConflictDoNothing();
  await db.insert(coupons).values(d.coupons).onConflictDoNothing();
  console.log(`Seeded: ${d.products.length} products, ${d.coupons.length} coupon.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
