CREATE TABLE "gift_voucher_redemption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voucher_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"redeemed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_voucher" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"voucher_number" varchar(40) NOT NULL,
	"customer_id" uuid,
	"original_sale_id" uuid,
	"face_value" numeric(12, 2) NOT NULL,
	"balance" numeric(12, 2) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"expiry_date" date,
	"notes" varchar(255),
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_voucher_voucher_number_unique" UNIQUE("voucher_number")
);
--> statement-breakpoint
ALTER TABLE "gift_voucher_redemption" ADD CONSTRAINT "gift_voucher_redemption_voucher_id_gift_voucher_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."gift_voucher"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_voucher_redemption" ADD CONSTRAINT "gift_voucher_redemption_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_voucher_redemption" ADD CONSTRAINT "gift_voucher_redemption_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_voucher" ADD CONSTRAINT "gift_voucher_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_voucher" ADD CONSTRAINT "gift_voucher_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_voucher" ADD CONSTRAINT "gift_voucher_original_sale_id_sale_id_fk" FOREIGN KEY ("original_sale_id") REFERENCES "public"."sale"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_voucher" ADD CONSTRAINT "gift_voucher_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gift_voucher_redemption_voucher_idx" ON "gift_voucher_redemption" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "gift_voucher_branch_idx" ON "gift_voucher" USING btree ("branch_id");