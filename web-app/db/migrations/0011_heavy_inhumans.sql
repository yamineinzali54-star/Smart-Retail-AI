CREATE TABLE "shift_handover" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"pos_session_id" uuid NOT NULL,
	"outgoing_user_id" uuid NOT NULL,
	"incoming_user_id" uuid,
	"expected_cash" numeric(12, 2) NOT NULL,
	"blind_count" numeric(12, 2) NOT NULL,
	"difference" numeric(12, 2) DEFAULT '0' NOT NULL,
	"notes" varchar(255),
	"handed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "registration_no" varchar(50);--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "tax_invoice_prefix" varchar(10);--> statement-breakpoint
ALTER TABLE "shift_handover" ADD CONSTRAINT "shift_handover_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handover" ADD CONSTRAINT "shift_handover_pos_session_id_pos_session_id_fk" FOREIGN KEY ("pos_session_id") REFERENCES "public"."pos_session"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handover" ADD CONSTRAINT "shift_handover_outgoing_user_id_users_id_fk" FOREIGN KEY ("outgoing_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handover" ADD CONSTRAINT "shift_handover_incoming_user_id_users_id_fk" FOREIGN KEY ("incoming_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_handover" ADD CONSTRAINT "shift_handover_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shift_handover_branch_idx" ON "shift_handover" USING btree ("branch_id");