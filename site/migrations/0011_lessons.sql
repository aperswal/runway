CREATE TABLE `lessons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund` text NOT NULL,
	`kind` text NOT NULL,
	`lesson` text NOT NULL,
	`trade_id` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `lessons_fund_created_at` ON `lessons` (`fund`,`created_at`);