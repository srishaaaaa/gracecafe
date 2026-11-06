ALTER TABLE "bills" ADD COLUMN "cash_amount" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "upi_amount" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "card_amount" numeric(12, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "bills" SET "cash_amount" = "total" WHERE "payment" = 'cash';--> statement-breakpoint
UPDATE "bills" SET "upi_amount" = "total" WHERE "payment" = 'upi';--> statement-breakpoint
UPDATE "bills" SET "card_amount" = "total" WHERE "payment" = 'card';
