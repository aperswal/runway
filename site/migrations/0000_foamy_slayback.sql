CREATE TABLE `distributions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`month` text NOT NULL,
	`start_equity` real NOT NULL,
	`end_equity` real NOT NULL,
	`costs_usd` real NOT NULL,
	`profit_usd` real NOT NULL,
	`payout_usd` real NOT NULL,
	`closed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `distributions_month_unique` ON `distributions` (`month`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund` text NOT NULL,
	`name` text NOT NULL,
	`hypothesis` text NOT NULL,
	`method` text NOT NULL,
	`result` text NOT NULL,
	`verdict` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `funds` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mandate` text NOT NULL,
	`share` real NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`retired_at` text,
	`retire_reason` text
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund` text NOT NULL,
	`symbol` text,
	`source` text NOT NULL,
	`metric` text NOT NULL,
	`value` real,
	`note` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trade_id` integer NOT NULL,
	`kind` text NOT NULL,
	`network` text NOT NULL,
	`status` text NOT NULL,
	`external_id` text,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`trigger` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_usd` real NOT NULL,
	`turns` integer NOT NULL,
	`summary` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taken_at` text NOT NULL,
	`equity` real NOT NULL,
	`cash` real NOT NULL,
	`positions` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fund` text NOT NULL,
	`symbol` text NOT NULL,
	`asset_class` text NOT NULL,
	`notional` real NOT NULL,
	`qty` real NOT NULL,
	`entry_price` real NOT NULL,
	`stop` real NOT NULL,
	`target` real NOT NULL,
	`horizon` text NOT NULL,
	`reason` text NOT NULL,
	`status` text NOT NULL,
	`order_id` text,
	`close_order_id` text,
	`exit_price` real,
	`exit_reason` text,
	`opened_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`fund`) REFERENCES `funds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trades_one_active_per_symbol` ON `trades` (`symbol`) WHERE "trades"."status" in ('pending', 'open', 'closing');