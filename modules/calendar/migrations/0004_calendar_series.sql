-- The provider series a repeating event belongs to (Google recurringEventId, Microsoft seriesMasterId): every instance of the series shares it, so the event pane can say how it
-- repeats and an edit can apply to This event or All events. Null for a one-off event. The next pull fills it in for events already here.
ALTER TABLE calendar_event ADD COLUMN "seriesId" TEXT;
