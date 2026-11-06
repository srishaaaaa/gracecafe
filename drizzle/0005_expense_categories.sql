CREATE TABLE "expense_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_uq" ON "expense_categories" USING btree (lower("name"));
--> statement-breakpoint
-- start the list with the old suggestions plus every category already used on an expense
INSERT INTO "expense_categories" ("id", "name", "created_at")
SELECT 'ecat_' || md5(lower(n)), n, (extract(epoch from now()) * 1000)::bigint
FROM (
  SELECT DISTINCT ON (lower(n)) n
  FROM (
    SELECT unnest(ARRAY['Ingredients', 'Rent', 'Salary', 'Utilities', 'Maintenance', 'Packaging', 'Marketing', 'Other']) AS n
    UNION ALL
    SELECT btrim("category") FROM "expenses"
  ) s
  WHERE n <> ''
  ORDER BY lower(n), n
) d
ON CONFLICT DO NOTHING;
