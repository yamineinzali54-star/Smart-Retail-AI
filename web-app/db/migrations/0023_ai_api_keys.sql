CREATE TABLE "ai_api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) NOT NULL,
	"label" varchar(120) NOT NULL,
	"key_purpose" varchar(20) DEFAULT 'inference' NOT NULL,
	"permissions" varchar(30),
	"api_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_check_status" varchar(30),
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_api_key_purpose_check" CHECK ("key_purpose" in ('inference', 'management', 'both'))
);
--> statement-breakpoint
ALTER TABLE "ai_api_key" ADD CONSTRAINT "ai_api_key_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_api_key" ADD CONSTRAINT "ai_api_key_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_api_key_provider_label_uniq" ON "ai_api_key" USING btree ("provider", "label");
--> statement-breakpoint
CREATE INDEX "ai_api_key_provider_active_idx" ON "ai_api_key" USING btree ("provider", "is_active");
--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "api_key_id" uuid;
--> statement-breakpoint
-- Preserve any existing model credentials by moving the already-encrypted
-- envelope as-is. This is also a no-op when the model table is empty.
INSERT INTO "ai_api_key" (
	"id", "provider", "label", "key_purpose", "api_key", "expires_at",
	"is_active", "created_by", "updated_by", "created_at", "updated_at"
)
SELECT
	"id", "provider", LEFT("model_name", 70) || ' · ' || "id"::text,
	'inference', "api_key", "expires_at", true, "created_by", "updated_by", "created_at", "updated_at"
FROM "ai_model";
--> statement-breakpoint
UPDATE "ai_model" SET "api_key_id" = "id";
--> statement-breakpoint
ALTER TABLE "ai_model" ALTER COLUMN "api_key_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_model" ADD CONSTRAINT "ai_model_api_key_id_ai_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."ai_api_key"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_model" DROP COLUMN "api_key";
--> statement-breakpoint
ALTER TABLE "ai_model" DROP COLUMN "expires_at";
--> statement-breakpoint
ALTER TABLE "ai_api_key" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS ai_api_key_select ON ai_api_key;
--> statement-breakpoint
DROP POLICY IF EXISTS ai_api_key_insert ON ai_api_key;
--> statement-breakpoint
DROP POLICY IF EXISTS ai_api_key_update ON ai_api_key;
--> statement-breakpoint
DROP POLICY IF EXISTS ai_api_key_delete ON ai_api_key;
--> statement-breakpoint
CREATE POLICY ai_api_key_select ON ai_api_key FOR SELECT TO authenticated USING (is_admin());
--> statement-breakpoint
CREATE POLICY ai_api_key_insert ON ai_api_key FOR INSERT TO authenticated WITH CHECK (is_admin());
--> statement-breakpoint
CREATE POLICY ai_api_key_update ON ai_api_key FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
--> statement-breakpoint
CREATE POLICY ai_api_key_delete ON ai_api_key FOR DELETE TO authenticated USING (is_admin());
