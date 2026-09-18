CREATE TABLE `plain` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`source_id` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`model` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plain_kind_source` ON `plain` (`kind`,`source_id`);