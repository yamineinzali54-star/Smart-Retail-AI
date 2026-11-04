ALTER TABLE "ai_api_key" ADD COLUMN "provider_limits_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "ai_api_key" ADD COLUMN "provider_limits_checked_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "ai_api_key" ADD COLUMN "provider_limits_status" varchar(30);
--> statement-breakpoint
ALTER TABLE "ai_model" DROP COLUMN "daily_request_limit";
--> statement-breakpoint
ALTER TABLE "ai_model" DROP COLUMN "monthly_request_limit";
--> statement-breakpoint
ALTER TABLE "ai_model" RENAME COLUMN "max_output_tokens" TO "provider_max_output_tokens";
--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "provider_context_length" integer;
--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "provider_request_limits" jsonb;
--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "provider_limits_checked_at" timestamptz;
