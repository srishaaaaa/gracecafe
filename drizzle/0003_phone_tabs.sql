-- Tabs are now found by phone number. Void open tabs that can't be keyed by one
-- (no phone, or a second open tab for the same phone), and cancel their unserved orders.
UPDATE "sessions" SET "status" = 'void', "closed_at" = (extract(epoch from now()) * 1000)::bigint
WHERE "status" = 'open' AND ("customer_phone" = '' OR "id" NOT IN (
  SELECT DISTINCT ON ("customer_phone") "id" FROM "sessions" WHERE "status" = 'open' AND "customer_phone" <> '' ORDER BY "customer_phone", "opened_at" DESC
));--> statement-breakpoint
UPDATE "orders" SET "status" = 'cancelled' WHERE "status" IN ('new', 'preparing') AND "session_id" IN (SELECT "id" FROM "sessions" WHERE "status" = 'void' AND "closed_at" IS NOT NULL);--> statement-breakpoint
UPDATE "bills" SET "source" = 'tab' WHERE "source" = 'table';--> statement-breakpoint
ALTER TABLE "tables" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "tables" CASCADE;--> statement-breakpoint
DROP INDEX "sessions_one_open_per_table";--> statement-breakpoint
DROP INDEX "sessions_table_idx";--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "customer_phone" DROP DEFAULT;--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_open_per_phone" ON "sessions" USING btree ("customer_phone") WHERE "sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "sessions_phone_idx" ON "sessions" USING btree ("customer_phone");--> statement-breakpoint
ALTER TABLE "bills" DROP COLUMN "table_id";--> statement-breakpoint
ALTER TABLE "bills" DROP COLUMN "table_label";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "table_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "table_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "guests";