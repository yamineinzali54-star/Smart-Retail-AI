CREATE TYPE "public"."credit_note_status" AS ENUM('open', 'partial', 'closed');--> statement-breakpoint
CREATE TYPE "public"."installment_due_status" AS ENUM('pending', 'partial', 'paid', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."installment_status" AS ENUM('active', 'completed', 'defaulted');--> statement-breakpoint
CREATE TYPE "public"."price_tier" AS ENUM('retail', 'wholesale');--> statement-breakpoint
CREATE TABLE "credit_note_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"note_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"applied_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"note_number" varchar(40) NOT NULL,
	"customer_id" uuid NOT NULL,
	"sale_return_id" uuid,
	"face_value" numeric(12, 2) NOT NULL,
	"balance" numeric(12, 2) NOT NULL,
	"status" "credit_note_status" DEFAULT 'open' NOT NULL,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_note_number_unique" UNIQUE("note_number")
);
--> statement-breakpoint
CREATE TABLE "installment_due" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "installment_due_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "installment_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"plan_number" varchar(40) NOT NULL,
	"sale_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"down_payment" numeric(12, 2) DEFAULT '0' NOT NULL,
	"financed_amount" numeric(12, 2) NOT NULL,
	"term_count" integer NOT NULL,
	"status" "installment_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installment_plan_plan_number_unique" UNIQUE("plan_number")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "price_tier" "price_tier" DEFAULT 'retail' NOT NULL;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "wholesale_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "credit_note_application" ADD CONSTRAINT "credit_note_application_note_id_credit_note_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."credit_note"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_application" ADD CONSTRAINT "credit_note_application_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note_application" ADD CONSTRAINT "credit_note_application_applied_by_users_id_fk" FOREIGN KEY ("applied_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_sale_return_id_sale_return_id_fk" FOREIGN KEY ("sale_return_id") REFERENCES "public"."sale_return"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_note" ADD CONSTRAINT "credit_note_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_due" ADD CONSTRAINT "installment_due_plan_id_installment_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."installment_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installment_plan" ADD CONSTRAINT "installment_plan_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_note_application_note_idx" ON "credit_note_application" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "credit_note_branch_idx" ON "credit_note" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "credit_note_customer_idx" ON "credit_note" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "installment_due_plan_idx" ON "installment_due" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "installment_plan_branch_idx" ON "installment_plan" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "installment_plan_customer_idx" ON "installment_plan" USING btree ("customer_id");