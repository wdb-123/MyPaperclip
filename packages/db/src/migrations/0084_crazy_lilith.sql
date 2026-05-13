DROP INDEX "workflow_stage_instances_workflow_idx";--> statement-breakpoint
ALTER TABLE "workflow_stage_instances" ADD COLUMN "stage_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_stage_instances_workflow_idx" ON "workflow_stage_instances" USING btree ("company_id","workflow_instance_id","stage_order");