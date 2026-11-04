CREATE TYPE "public"."po_approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "branch" ADD COLUMN "po_approval_threshold" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "approval_status" "po_approval_status" DEFAULT 'approved' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD COLUMN "approved_by" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;