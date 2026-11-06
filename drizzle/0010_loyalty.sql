ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "loyalty_customer_id" text;
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "points_redeemed" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "points_discount" numeric(12, 2) DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "reward_ref" text;
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "reward_name" text;
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "reward_discount" numeric(12, 2) DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "points_earned" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_customers" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"phone" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"birthday" text DEFAULT '' NOT NULL,
	"anniversary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"consent" boolean DEFAULT true NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by" text,
	"wallet_token" text NOT NULL,
	"tier" text DEFAULT 'bronze' NOT NULL,
	"tier_since" bigint NOT NULL,
	"available" integer DEFAULT 0 NOT NULL,
	"lifetime" integer DEFAULT 0 NOT NULL,
	"redeemed" integer DEFAULT 0 NOT NULL,
	"expired" integer DEFAULT 0 NOT NULL,
	"debt" integer DEFAULT 0 NOT NULL,
	"stamps" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_customers_phone_uq" ON "loyalty_customers" USING btree ("phone");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_customers_code_uq" ON "loyalty_customers" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_customers_ref_uq" ON "loyalty_customers" USING btree ("referral_code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_customers_wallet_uq" ON "loyalty_customers" USING btree ("wallet_token");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL REFERENCES "loyalty_customers"("id"),
	"type" text NOT NULL,
	"points" integer NOT NULL,
	"balance_before" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"bill_id" text,
	"invoice_no" text,
	"ref" text DEFAULT '' NOT NULL,
	"key" text,
	"description" text DEFAULT '' NOT NULL,
	"expires_at" bigint,
	"actor" text DEFAULT 'system' NOT NULL,
	"reversal_of" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_ledger_key_uq" ON "loyalty_ledger" USING btree ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_ledger_customer_idx" ON "loyalty_ledger" USING btree ("customer_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_ledger_created_idx" ON "loyalty_ledger" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_ledger_bill_idx" ON "loyalty_ledger" USING btree ("bill_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_lots" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL REFERENCES "loyalty_customers"("id"),
	"ledger_id" text NOT NULL REFERENCES "loyalty_ledger"("id"),
	"points" integer NOT NULL,
	"remaining" integer NOT NULL,
	"earned_at" bigint NOT NULL,
	"expires_at" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_lots_customer_idx" ON "loyalty_lots" USING btree ("customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_rewards" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(12, 2) DEFAULT 0 NOT NULL,
	"product_id" text,
	"points_cost" integer DEFAULT 0 NOT NULL,
	"tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_on" text,
	"ends_on" text,
	"active" boolean DEFAULT true NOT NULL,
	"max_redemptions" integer,
	"per_customer_limit" integer,
	"terms" text DEFAULT '' NOT NULL,
	"redeemed" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_vouchers" (
	"id" text PRIMARY KEY NOT NULL,
	"ref" text NOT NULL,
	"customer_id" text NOT NULL REFERENCES "loyalty_customers"("id"),
	"reward_id" text,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(12, 2) DEFAULT 0 NOT NULL,
	"product_id" text,
	"source" text NOT NULL,
	"points_cost" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"bill_id" text,
	"invoice_no" text,
	"key" text,
	"issued_at" bigint NOT NULL,
	"used_at" bigint,
	"expires_at" bigint,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_vouchers_ref_uq" ON "loyalty_vouchers" USING btree ("ref");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_vouchers_key_uq" ON "loyalty_vouchers" USING btree ("key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_vouchers_customer_idx" ON "loyalty_vouchers" USING btree ("customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_stamps" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL REFERENCES "loyalty_customers"("id"),
	"bill_id" text NOT NULL,
	"visit_key" text NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_stamps_visit_uq" ON "loyalty_stamps" USING btree ("visit_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_stamps_customer_idx" ON "loyalty_stamps" USING btree ("customer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer_id" text NOT NULL REFERENCES "loyalty_customers"("id"),
	"referee_id" text NOT NULL REFERENCES "loyalty_customers"("id"),
	"status" text NOT NULL,
	"bill_id" text,
	"referrer_points" integer DEFAULT 0 NOT NULL,
	"referee_points" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"rewarded_at" bigint
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_referrals_referee_uq" ON "loyalty_referrals" USING btree ("referee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_referrals_referrer_idx" ON "loyalty_referrals" USING btree ("referrer_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text NOT NULL,
	"value" numeric(12, 2) DEFAULT 0 NOT NULL,
	"starts_on" text DEFAULT '' NOT NULL,
	"ends_on" text DEFAULT '' NOT NULL,
	"start_time" text DEFAULT '' NOT NULL,
	"end_time" text DEFAULT '' NOT NULL,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_purchase" numeric(12, 2) DEFAULT 0 NOT NULL,
	"tiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage_limit" integer,
	"per_customer_limit" integer,
	"active" boolean DEFAULT true NOT NULL,
	"used" integer DEFAULT 0 NOT NULL,
	"points_given" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "loyalty_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"customer_id" text,
	"ref" text DEFAULT '' NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_audit_created_idx" ON "loyalty_audit" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "loyalty_audit_customer_idx" ON "loyalty_audit" USING btree ("customer_id");
