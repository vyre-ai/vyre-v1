-- Which Google or Microsoft account a provider calendar is read as. The pull asks the provider for this address's calendar, whoever runs the sync (the person, or the server on a poll).
CREATE TABLE IF NOT EXISTS calendar_account (
  "calendarId" TEXT PRIMARY KEY,
  account TEXT NOT NULL
);
