CREATE TABLE "bills" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_no" text NOT NULL,
	"source" text NOT NULL,
	"table_id" text,
	"table_label" text NOT NULL,
	"session_id" text,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"items" jsonb NOT NULL,
	"item_count" integer NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"coupon_code" text,
	"coupon_percent" numeric(12, 2) DEFAULT 0 NOT NULL,
	"coupon_discount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"manual_type" text NOT NULL,
	"manual_value" numeric(12, 2) DEFAULT 0 NOT NULL,
	"manual_discount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"discount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"extra" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"payment" text NOT NULL,
	"received" numeric(12, 2) NOT NULL,
	"change" numeric(12, 2) DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"percent" numeric(12, 2) NOT NULL,
	"min_order" numeric(12, 2) DEFAULT 0 NOT NULL,
	"expires_at" text,
	"usage_limit" integer,
	"used" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"fails" integer DEFAULT 0 NOT NULL,
	"locked_until" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL,
	"order_seq" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"no" integer NOT NULL,
	"table_id" text NOT NULL,
	"session_id" text NOT NULL,
	"items" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"stock" integer,
	"low_at" integer DEFAULT 4 NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image" text DEFAULT '' NOT NULL,
	"eggless" boolean DEFAULT false NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"table_id" text NOT NULL,
	"status" text NOT NULL,
	"opened_at" bigint NOT NULL,
	"closed_at" bigint,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_phone" text DEFAULT '' NOT NULL,
	"guests" integer NOT NULL,
	"bill_requested_at" bigint,
	"bill_id" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"shop_name" text NOT NULL,
	"public_url" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"mobile" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"seats" integer NOT NULL,
	"code" text NOT NULL,
	"session_id" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bills_invoice_uq" ON "bills" USING btree ("invoice_no");--> statement-breakpoint
CREATE INDEX "bills_created_idx" ON "bills" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_uq" ON "coupons" USING btree ("code");--> statement-breakpoint
CREATE INDEX "orders_session_idx" ON "orders" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_open_per_table" ON "sessions" USING btree ("table_id") WHERE "sessions"."status" = 'open';--> statement-breakpoint
CREATE INDEX "sessions_table_idx" ON "sessions" USING btree ("table_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_mobile_uq" ON "staff_users" USING btree ("mobile");--> statement-breakpoint
CREATE UNIQUE INDEX "tables_code_uq" ON "tables" USING btree ("code");