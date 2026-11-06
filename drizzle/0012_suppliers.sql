CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_person" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"supplies" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_name_uq" ON "suppliers" USING btree ("name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "supplier_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"invoice_no" text NOT NULL,
	"invoice_date" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"gst_percent" numeric(12, 2) DEFAULT 0 NOT NULL,
	"gst_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"payment_mode" text DEFAULT 'cash' NOT NULL,
	"due_date" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_invoices_supplier_idx" ON "supplier_invoices" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_invoices_date_idx" ON "supplier_invoices" USING btree ("invoice_date");
