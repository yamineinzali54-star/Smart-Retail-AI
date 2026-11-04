ALTER TABLE "ai_model" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_model_single_default_uniq" ON "ai_model" USING btree ("is_default") WHERE "ai_model"."is_default" = true;--> statement-breakpoint
ALTER TABLE "ai_model" ADD CONSTRAINT "ai_model_default_active_check" CHECK (not "ai_model"."is_default" or "ai_model"."is_active");