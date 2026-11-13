-- How many tables the shop has; the admin sets it in Settings and prints one QR card per table.
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "table_count" integer DEFAULT 0 NOT NULL;
