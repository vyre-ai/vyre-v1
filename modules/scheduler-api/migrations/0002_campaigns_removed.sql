-- The Campaigns product left Vyre: a schedule that called it would only fail from now on.
UPDATE scheduler_api_schedules SET active = 0, paused_reason = 'Campaigns were removed', next_at = NULL WHERE owner_kind = 'campaign' OR cap LIKE 'campaigns.%' OR cap LIKE 'warmup.%';
