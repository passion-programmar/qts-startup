ALTER TABLE "profiles" ALTER COLUMN "country_code" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "profiles" RENAME COLUMN "country_code" TO "country";--> statement-breakpoint
ALTER TABLE "profiles" DROP COLUMN "address_line_2";