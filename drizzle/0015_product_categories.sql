CREATE TABLE IF NOT EXISTS "product_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_categories_name_uq" ON "product_categories" USING btree (lower("name"));
