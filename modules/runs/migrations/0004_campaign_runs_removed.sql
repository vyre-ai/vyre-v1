-- The Campaigns product left Vyre: a campaign Run still open has no engine behind it, so it ends. Finished Runs stay as history.
UPDATE runs_items SET status = 'stopped', ended_at = COALESCE(ended_at, updated_at) WHERE kind = 'campaign' AND status NOT IN ('succeeded', 'failed', 'stopped');
