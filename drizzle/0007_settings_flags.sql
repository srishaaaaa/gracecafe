ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "walk_ins_only" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "kot_enabled" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "ordering_enabled" boolean DEFAULT true NOT NULL;
