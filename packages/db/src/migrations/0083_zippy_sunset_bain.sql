CREATE TABLE "workflow_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"template_id" uuid,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_stage_key" text,
	"created_by_user_id" text,
	"created_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"stage_instance_id" uuid NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"role" text NOT NULL,
	"decision" text,
	"decision_note" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stage_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"workflow_instance_id" uuid NOT NULL,
	"stage_key" text NOT NULL,
	"stage_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"required_decisions" integer DEFAULT 1 NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger_kind" text DEFAULT 'manual' NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_template_id_workflow_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."workflow_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_instances" ADD CONSTRAINT "workflow_instances_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_participants" ADD CONSTRAINT "workflow_participants_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_participants" ADD CONSTRAINT "workflow_participants_stage_instance_id_workflow_stage_instances_id_fk" FOREIGN KEY ("stage_instance_id") REFERENCES "public"."workflow_stage_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_instances" ADD CONSTRAINT "workflow_stage_instances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stage_instances" ADD CONSTRAINT "workflow_stage_instances_workflow_instance_id_workflow_instances_id_fk" FOREIGN KEY ("workflow_instance_id") REFERENCES "public"."workflow_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_instances_subject_idx" ON "workflow_instances" USING btree ("company_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "workflow_instances_company_status_idx" ON "workflow_instances" USING btree ("company_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "workflow_participants_principal_role_idx" ON "workflow_participants" USING btree ("company_id","principal_type","principal_id","role");--> statement-breakpoint
CREATE INDEX "workflow_participants_stage_role_idx" ON "workflow_participants" USING btree ("company_id","stage_instance_id","role");--> statement-breakpoint
CREATE INDEX "workflow_stage_instances_workflow_idx" ON "workflow_stage_instances" USING btree ("company_id","workflow_instance_id");--> statement-breakpoint
CREATE INDEX "workflow_stage_instances_status_idx" ON "workflow_stage_instances" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "workflow_templates_company_status_idx" ON "workflow_templates" USING btree ("company_id","status");