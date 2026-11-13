-- Which table an order came from (the number carried by the table's QR code). Empty = no table.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "table_no" text DEFAULT '' NOT NULL;
