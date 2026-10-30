CREATE TABLE "waitlist" (
	"email" text PRIMARY KEY NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
