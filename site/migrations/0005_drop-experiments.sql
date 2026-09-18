INSERT INTO `analyses` (`fund`, `kind`, `symbols`, `title`, `body`, `figures`, `verdict`, `created_at`)
SELECT `fund`, 'backtest', NULL, `name`, 'Hypothesis: ' || `hypothesis` || char(10) || 'Method: ' || `method` || char(10) || 'Result: ' || `result`, '{}', `verdict`, `created_at`
FROM `experiments` ORDER BY `id`;
--> statement-breakpoint
DROP TABLE `experiments`;
