-- When a provider calendar's last pull worked, on the calendar row itself so it reaches every device with the row: the sidebar says Syncing until the first pull and
-- "Synced 2 min ago" after. calendar_sync keeps the cursor and the error; this is the one fact a person sees. The next scheduled pull (every two minutes) fills it in.
ALTER TABLE calendar_list ADD COLUMN "lastSyncAt" INTEGER;
