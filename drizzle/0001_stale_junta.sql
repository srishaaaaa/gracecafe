CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_mode" text DEFAULT 'cash' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"expense_date" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text NOT NULL,
	"type" text NOT NULL,
	"qty" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "coupon_source" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "coupon_code" text;--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "stock_moves_created_idx" ON "stock_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "stock_moves_product_idx" ON "stock_movements" USING btree ("product_id");