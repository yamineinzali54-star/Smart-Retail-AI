CREATE TABLE "ai_chat_conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"status" varchar(20) DEFAULT 'complete' NOT NULL,
	"model_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_chat_message_role_check" CHECK ("role" in ('user', 'assistant')),
	CONSTRAINT "ai_chat_message_status_check" CHECK ("status" in ('pending', 'complete', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "ai_chat_conversation" ADD CONSTRAINT "ai_chat_conversation_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_chat_conversation" ADD CONSTRAINT "ai_chat_conversation_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_chat_message" ADD CONSTRAINT "ai_chat_message_conversation_id_ai_chat_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_chat_conversation"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_chat_message" ADD CONSTRAINT "ai_chat_message_model_id_ai_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_model"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "ai_chat_conversation_owner_updated_idx" ON "ai_chat_conversation" USING btree ("user_id", "branch_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "ai_chat_message_conversation_created_idx" ON "ai_chat_message" USING btree ("conversation_id", "created_at");
