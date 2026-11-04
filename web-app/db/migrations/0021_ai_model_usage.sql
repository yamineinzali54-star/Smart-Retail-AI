ALTER TABLE "ai_model" ADD COLUMN "total_tokens_today" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "total_tokens_this_month" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "cost_usd_today" numeric(18,8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "cost_usd_this_month" numeric(18,8) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "cost_reported_today" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_model" ADD COLUMN "cost_reported_this_month" boolean DEFAULT false NOT NULL;
