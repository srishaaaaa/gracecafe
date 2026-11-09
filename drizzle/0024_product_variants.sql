ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "family" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "variant" text DEFAULT '' NOT NULL;
