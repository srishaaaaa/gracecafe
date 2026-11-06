ALTER TABLE "gift_offers" ADD COLUMN IF NOT EXISTS "audience" text DEFAULT 'all' NOT NULL;
ALTER TABLE "gift_offers" ADD COLUMN IF NOT EXISTS "max_total" integer;
