CREATE TABLE "ai_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(40) DEFAULT 'openrouter' NOT NULL,
	"model_name" varchar(200) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"api_key" text NOT NULL,
	"expires_at" timestamp with time zone,
	"daily_request_limit" integer,
	"monthly_request_limit" integer,
	"max_output_tokens" integer,
	"requests_today" integer DEFAULT 0 NOT NULL,
	"requests_this_month" integer DEFAULT 0 NOT NULL,
	"usage_day" date DEFAULT CURRENT_DATE NOT NULL,
	"usage_month" date DEFAULT date_trunc('month', CURRENT_DATE)::date NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_model" ADD CONSTRAINT "ai_model_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model" ADD CONSTRAINT "ai_model_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_model_active_sort_idx" ON "ai_model" USING btree ("is_active","sort_order");
--> statement-breakpoint
ALTER TABLE ai_model ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_model_select ON ai_model;
DROP POLICY IF EXISTS ai_model_insert ON ai_model;
DROP POLICY IF EXISTS ai_model_update ON ai_model;
DROP POLICY IF EXISTS ai_model_delete ON ai_model;
CREATE POLICY ai_model_select ON ai_model FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY ai_model_insert ON ai_model FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY ai_model_update ON ai_model FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY ai_model_delete ON ai_model FOR DELETE TO authenticated USING (is_admin());
