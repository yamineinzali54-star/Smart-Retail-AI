ALTER TABLE "ai_api_key" DROP CONSTRAINT "ai_api_key_purpose_check";--> statement-breakpoint
ALTER TABLE "ai_api_key" ALTER COLUMN "is_active" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "ai_api_key" ADD CONSTRAINT "ai_api_key_purpose_check" CHECK ("ai_api_key"."key_purpose" in ('inference', 'management', 'both'));