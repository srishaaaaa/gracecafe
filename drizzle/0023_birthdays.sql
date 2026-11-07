CREATE TABLE IF NOT EXISTS "birthdays" (
	"phone" text PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"dob" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "birthday_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"offers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected" text DEFAULT '' NOT NULL,
	"template" text DEFAULT '' NOT NULL
);
