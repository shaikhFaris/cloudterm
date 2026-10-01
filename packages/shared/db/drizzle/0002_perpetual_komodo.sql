ALTER TABLE "workspaces" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."workspace_status";--> statement-breakpoint
CREATE TYPE "public"."workspace_status" AS ENUM('queued', 'running', 'deleted');--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "status" SET DATA TYPE "public"."workspace_status" USING "status"::"public"."workspace_status";