ALTER TABLE `funds` ADD `capital` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `funds` ADD `high_water` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `funds` ADD `rescues` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `funds` ADD `rescued_at` text;