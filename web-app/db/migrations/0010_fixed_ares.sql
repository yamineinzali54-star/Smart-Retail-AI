ALTER TABLE "sale" ADD COLUMN "mobile_provider" varchar(30);--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "mobile_transaction_id" varchar(100);--> statement-breakpoint
CREATE UNIQUE INDEX "sale_mobile_txn_uniq" ON "sale" USING btree ("branch_id","mobile_provider","mobile_transaction_id") WHERE mobile_provider IS NOT NULL AND mobile_transaction_id IS NOT NULL;