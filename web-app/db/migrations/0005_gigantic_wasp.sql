ALTER TABLE "cart" DROP CONSTRAINT "cart_pos_session_id_unique";--> statement-breakpoint
ALTER TABLE "cart" ADD COLUMN "status" varchar(20) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "cart" ADD COLUMN "label" varchar(100);