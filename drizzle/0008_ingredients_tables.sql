CREATE TABLE IF NOT EXISTS "batches" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"total_cost" numeric(12, 2) DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingredient_moves" (
	"id" text PRIMARY KEY NOT NULL,
	"ingredient_id" text NOT NULL,
	"ingredient_name" text NOT NULL,
	"unit" text NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"type" text NOT NULL,
	"cost" numeric(12, 2) DEFAULT 0 NOT NULL,
	"balance_after" numeric(14, 3) NOT NULL,
	"batch_id" text,
	"note" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ingredients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"stock" numeric(14, 3) DEFAULT 0 NOT NULL,
	"cost_per_unit" numeric(14, 6) DEFAULT 0 NOT NULL,
	"low_at" numeric(14, 3) DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recipes" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "batches_created_idx" ON "batches" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingredient_moves_created_idx" ON "ingredient_moves" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingredient_moves_ing_idx" ON "ingredient_moves" USING btree ("ingredient_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ingredient_moves_batch_idx" ON "ingredient_moves" USING btree ("batch_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ingredients_name_uq" ON "ingredients" USING btree (lower("name"));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "recipes_name_uq" ON "recipes" USING btree (lower("name"));
