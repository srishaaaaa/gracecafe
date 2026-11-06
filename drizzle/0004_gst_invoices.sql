ALTER TABLE "bills" ADD COLUMN "is_gst" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "gst_percent" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "taxable_amount" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "gst_amount" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "bills" SET "taxable_amount" = "total";