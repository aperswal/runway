CREATE TABLE `manager_runs` (
	`key` text PRIMARY KEY NOT NULL,
	`fund` text NOT NULL,
	`trigger` text NOT NULL,
	`outcome` text,
	`started_at` text NOT NULL,
	`finished_at` text
);
