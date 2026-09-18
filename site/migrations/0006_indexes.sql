CREATE INDEX `analyses_created_at_id` ON `analyses` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `analyses_fund` ON `analyses` (`fund`);--> statement-breakpoint
CREATE INDEX `analyses_kind` ON `analyses` (`kind`);--> statement-breakpoint
CREATE INDEX `jobs_status_next_run_at` ON `jobs` (`status`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `monitors_status_event_at` ON `monitors` (`status`,`event_at`);--> statement-breakpoint
CREATE INDEX `notes_fund_created_at` ON `notes` (`fund`,`created_at`);--> statement-breakpoint
CREATE INDEX `observations_fund_created_at` ON `observations` (`fund`,`created_at`);--> statement-breakpoint
CREATE INDEX `observations_symbol` ON `observations` (`symbol`);--> statement-breakpoint
CREATE INDEX `posts_network_status_created_at` ON `posts` (`network`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `runs_started_at` ON `runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `runs_finished_at` ON `runs` (`finished_at`);--> statement-breakpoint
CREATE INDEX `snapshots_taken_at` ON `snapshots` (`taken_at`);--> statement-breakpoint
CREATE INDEX `trades_status` ON `trades` (`status`);--> statement-breakpoint
CREATE INDEX `trades_closed_at` ON `trades` (`closed_at`);