CREATE TABLE "roster_schedule_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"planned_start" varchar(5) NOT NULL,
	"planned_end" varchar(5) NOT NULL,
	"counter_id" uuid,
	"notes" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "roster_schedule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roster_schedule_entry" ADD CONSTRAINT "roster_schedule_entry_schedule_id_roster_schedule_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."roster_schedule"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_schedule_entry" ADD CONSTRAINT "roster_schedule_entry_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_schedule_entry" ADD CONSTRAINT "roster_schedule_entry_counter_id_counter_id_fk" FOREIGN KEY ("counter_id") REFERENCES "public"."counter"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_schedule" ADD CONSTRAINT "roster_schedule_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_schedule" ADD CONSTRAINT "roster_schedule_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "roster_schedule_entry_schedule_idx" ON "roster_schedule_entry" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "roster_schedule_entry_user_idx" ON "roster_schedule_entry" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "roster_schedule_branch_idx" ON "roster_schedule" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "roster_schedule_branch_start_idx" ON "roster_schedule" USING btree ("branch_id","start_date");