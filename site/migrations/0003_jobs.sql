CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund` text NOT NULL,
	`name` text NOT NULL,
	`script` text NOT NULL,
	`every_minutes` integer NOT NULL,
	`remaining_runs` integer NOT NULL,
	`timeout_seconds` integer NOT NULL,
	`status` text NOT NULL,
	`next_run_at` text NOT NULL,
	`last_run_at` text,
	`last_output` text,
	`last_exit_code` integer,
	`created_at` text NOT NULL
);
