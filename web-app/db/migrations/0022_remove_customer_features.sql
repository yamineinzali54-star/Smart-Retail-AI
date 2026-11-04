ALTER TABLE "credit_note_application" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DELETE FROM "audit_log" WHERE lower("entity_type") IN ('customer', 'customerledger', 'customer_ledger', 'loyaltyledger', 'loyalty_ledger', 'creditnote', 'credit_note', 'installmentplan', 'installment_plan', 'giftvoucher', 'gift_voucher');--> statement-breakpoint
DELETE FROM "permission" WHERE "action_key" = 'credit_sale.approve';--> statement-breakpoint
ALTER TABLE "credit_note" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customer_ledger" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gift_voucher_redemption" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gift_voucher" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installment_due" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "installment_plan" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "loyalty_ledger" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "credit_note_application" CASCADE;--> statement-breakpoint
DROP TABLE "credit_note" CASCADE;--> statement-breakpoint
DROP TABLE "customer_ledger" CASCADE;--> statement-breakpoint
DROP TABLE "customers" CASCADE;--> statement-breakpoint
DROP TABLE "gift_voucher_redemption" CASCADE;--> statement-breakpoint
DROP TABLE "gift_voucher" CASCADE;--> statement-breakpoint
DROP TABLE "installment_due" CASCADE;--> statement-breakpoint
DROP TABLE "installment_plan" CASCADE;--> statement-breakpoint
DROP TABLE "loyalty_ledger" CASCADE;--> statement-breakpoint
ALTER TABLE "sale" DROP CONSTRAINT IF EXISTS "sale_customer_id_customers_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_model" ALTER COLUMN "cost_usd_today" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "ai_model" ALTER COLUMN "cost_usd_this_month" SET DATA TYPE numeric(18, 8);--> statement-breakpoint
ALTER TABLE "branch" DROP COLUMN "loyalty_enabled";--> statement-breakpoint
ALTER TABLE "branch" DROP COLUMN "loyalty_earn_rate";--> statement-breakpoint
ALTER TABLE "branch" DROP COLUMN "loyalty_point_value";--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "wholesale_price";--> statement-breakpoint
ALTER TABLE "sale" DROP COLUMN "customer_id";--> statement-breakpoint
DROP TYPE "public"."credit_note_status";--> statement-breakpoint
DROP TYPE "public"."installment_due_status";--> statement-breakpoint
DROP TYPE "public"."installment_status";--> statement-breakpoint
DROP TYPE "public"."ledger_type";--> statement-breakpoint
DROP TYPE "public"."loyalty_type";--> statement-breakpoint
DROP TYPE "public"."price_tier";
