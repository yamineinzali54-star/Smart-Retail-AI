CREATE TABLE "staff_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"clock_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clock_out_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_attendance_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action,
	CONSTRAINT "staff_attendance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "staff_attendance_branch_clock_in_idx" ON "staff_attendance" USING btree ("branch_id", "clock_in_at");
--> statement-breakpoint
CREATE INDEX "staff_attendance_user_clock_in_idx" ON "staff_attendance" USING btree ("user_id", "clock_in_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "staff_attendance_active_user_uniq" ON "staff_attendance" USING btree ("user_id") WHERE clock_out_at IS NULL;
