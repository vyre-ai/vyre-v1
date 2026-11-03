-- How to join an event, as the provider said it (Google conferenceData, Graph onlineMeeting) or as Vyre made it (a Zoom meeting): JSON with the provider, the link, the meeting id and
-- passcode, and the dial-in numbers with their PIN. Null when the event says nothing about joining. The next pull fills it in for events already here.
ALTER TABLE calendar_event ADD COLUMN conference TEXT;
