CREATE TABLE `analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund` text NOT NULL,
	`kind` text NOT NULL,
	`symbols` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`figures` text NOT NULL,
	`verdict` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund` text NOT NULL,
	`symbol` text NOT NULL,
	`event` text NOT NULL,
	`event_at` text NOT NULL,
	`watch` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`created_at` text NOT NULL,
	`done_at` text
);
--> statement-breakpoint
ALTER TABLE `trades` ADD `limit_price` real;