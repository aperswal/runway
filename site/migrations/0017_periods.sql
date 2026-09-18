DROP INDEX `distributions_month_unique`;--> statement-breakpoint
ALTER TABLE `distributions` RENAME COLUMN `month` TO `period`;--> statement-breakpoint
CREATE UNIQUE INDEX `distributions_period_unique` ON `distributions` (`period`);
