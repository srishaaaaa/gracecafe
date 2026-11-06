ALTER TABLE "loyalty_customers" ADD COLUMN IF NOT EXISTS "whatsapp" text DEFAULT '' NOT NULL;
ALTER TABLE "loyalty_rewards" ADD COLUMN IF NOT EXISTS "trigger" text DEFAULT 'points' NOT NULL;
ALTER TABLE "loyalty_rewards" ADD COLUMN IF NOT EXISTS "milestone_amount" numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE "loyalty_rewards" ADD COLUMN IF NOT EXISTS "gift_qty" integer DEFAULT 1 NOT NULL;
ALTER TABLE "loyalty_vouchers" ADD COLUMN IF NOT EXISTS "gift_qty" integer DEFAULT 1 NOT NULL;
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "loyalty_prev" integer;
ALTER TABLE "bills" ADD COLUMN IF NOT EXISTS "loyalty_balance" integer;
CREATE TABLE IF NOT EXISTS "gift_offers" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL,
  "min_bill" numeric(12,2) DEFAULT 0 NOT NULL,
  "product_id" text,
  "buy_qty" integer DEFAULT 1 NOT NULL,
  "gift_product_id" text NOT NULL,
  "gift_qty" integer DEFAULT 1 NOT NULL,
  "repeatable" boolean DEFAULT false NOT NULL,
  "starts_on" text,
  "ends_on" text,
  "active" boolean DEFAULT true NOT NULL,
  "given" integer DEFAULT 0 NOT NULL,
  "created_at" bigint NOT NULL,
  "updated_at" bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS "loyalty_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "customer_id" text NOT NULL,
  "type" text NOT NULL,
  "phone" text DEFAULT '' NOT NULL,
  "text" text NOT NULL,
  "status" text NOT NULL,
  "error" text DEFAULT '' NOT NULL,
  "bill_id" text,
  "key" text,
  "created_at" bigint NOT NULL,
  "opened_at" bigint,
  "opens" integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "loyalty_messages_key_uq" ON "loyalty_messages" ("key");
CREATE INDEX IF NOT EXISTS "loyalty_messages_customer_idx" ON "loyalty_messages" ("customer_id","created_at");
