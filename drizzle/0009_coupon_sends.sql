ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "restricted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "phones" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "sent" integer DEFAULT 0 NOT NULL;
