CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"target_name" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"before" jsonb,
	"requested_by" text DEFAULT 'staff' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"decided_at" bigint
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_status_idx" ON "approval_requests" USING btree ("status","created_at");
