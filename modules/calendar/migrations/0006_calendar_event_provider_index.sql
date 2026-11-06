-- The pull looks an event up by (calendar, provider id) once per event it lands; with only the calendar indexed that was a scan of the whole calendar each time.
CREATE INDEX IF NOT EXISTS calendar_event__provider ON calendar_event ("calendarId", "providerId");
