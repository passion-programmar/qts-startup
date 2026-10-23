ALTER TYPE "public"."generation_run_status" ADD VALUE IF NOT EXISTS 'delivered' AFTER 'completed';
