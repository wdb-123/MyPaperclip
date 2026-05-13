CREATE TABLE "notification_inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"recipient_type" text NOT NULL,
	"recipient_id" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"source_key" text NOT NULL,
	"action_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"status" text DEFAULT 'unread' NOT NULL,
	"requires_action" boolean DEFAULT false NOT NULL,
	"delivery_channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_inbox_items" ADD CONSTRAINT "notification_inbox_items_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_inbox_items_recipient_status_idx" ON "notification_inbox_items" USING btree ("company_id","recipient_type","recipient_id","status");--> statement-breakpoint
CREATE INDEX "notification_inbox_items_subject_idx" ON "notification_inbox_items" USING btree ("company_id","subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_inbox_items_source_key_idx" ON "notification_inbox_items" USING btree ("company_id","source_key");