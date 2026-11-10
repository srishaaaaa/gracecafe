-- The Activity log and the Ingredient log are removed from the app, so their tables go too.
-- Apply this AFTER the code that no longer writes to them is deployed.
DROP TABLE IF EXISTS "activity_log";
--> statement-breakpoint
DROP TABLE IF EXISTS "ingredient_moves";
