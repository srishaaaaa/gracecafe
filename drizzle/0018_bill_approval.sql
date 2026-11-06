ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "bill_approved_at" bigint;
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "approved_amount" numeric(12, 2) DEFAULT 0 NOT NULL;
