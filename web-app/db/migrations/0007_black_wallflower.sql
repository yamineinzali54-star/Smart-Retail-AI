CREATE TYPE "public"."loyalty_type" AS ENUM('earn', 'redeem', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."print_job_status" AS ENUM('queued', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."print_job_type" AS ENUM('receipt', 'label', 'drawer');--> statement-breakpoint
CREATE TYPE "public"."printer_type" AS ENUM('thermal', 'label');--> statement-breakpoint
CREATE TABLE "loyalty_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"sale_id" uuid,
	"type" "loyalty_type" NOT NULL,
	"points" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"transaction_date" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "print_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"printer_id" uuid,
	"type" "print_job_type" NOT NULL,
	"status" "print_job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"sale_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(255),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "printer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "printer_type" NOT NULL,
	"connection" varchar(255) NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_branch" (
	"user_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "loyalty_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "loyalty_earn_rate" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "loyalty_point_value" numeric(12, 2) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" ADD CONSTRAINT "loyalty_ledger_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_printer_id_printer_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printer"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "print_job" ADD CONSTRAINT "print_job_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printer" ADD CONSTRAINT "printer_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branch" ADD CONSTRAINT "user_branch_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_branch" ADD CONSTRAINT "user_branch_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "loyalty_ledger_customer_idx" ON "loyalty_ledger" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "loyalty_ledger_branch_idx" ON "loyalty_ledger" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "print_job_branch_idx" ON "print_job" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "print_job_status_idx" ON "print_job" USING btree ("status");--> statement-breakpoint
CREATE INDEX "printer_branch_idx" ON "printer" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "user_branch_user_idx" ON "user_branch" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_branch_user_branch_uniq" ON "user_branch" USING btree ("user_id","branch_id");--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "user_branch" ("user_id", "branch_id") SELECT "id", "branch_id" FROM "users" ON CONFLICT DO NOTHING;