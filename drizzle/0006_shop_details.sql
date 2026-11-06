ALTER TABLE "settings" ADD COLUMN "owner_name" text DEFAULT 'KARTHIKEYAN G' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "location" text DEFAULT 'New bustand, Thanjavur' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "address" text DEFAULT E'Shop no : 6
Municipal complex
C block
New bustand
Thanjavur 613005' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "email" text DEFAULT 'eightistotwo@gmail.com' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "address2" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "whatsapp1" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "whatsapp2" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "customer_care" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "maps_url" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "logo_url" text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE "settings" SET "shop_name" = '8:2''s chayakkada' WHERE "id" = 1;
