ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "pay_claimed_at" bigint;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "pay_claimed_amount" numeric(12, 2) DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "pay_claimed_ref" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "upi_id" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "upi_name" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "upi_qr_minutes" integer DEFAULT 5 NOT NULL;
