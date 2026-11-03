// Recorded provider answers for the calendar push tests (shapes as the google, microsoft and zoom connectors map them; invented people and ids). Google's answer to an event made with a
// Meet createRequest carries hangoutLink and conferenceData (video, phone with PIN, more); Graph's answer to isOnlineMeeting carries onlineMeeting; Zoom's carries the dial-in list.
export const GOOGLE_CREATED_WITH_MEET = (summary: string, startIso: string, endIso: string) => ({
  id: "g_evt_7k2", status: "confirmed", summary, start: { dateTime: startIso }, end: { dateTime: endIso }, hangoutLink: "https://meet.google.com/abc-defg-hij",
  organizer: { email: "maya@vyre.test" },
  attendees: [{ email: "maya@vyre.test", responseStatus: "accepted" }, { email: "pat@client.test", responseStatus: "needsAction" }],
  conferenceData: {
    conferenceId: "abc-defg-hij", conferenceSolution: { key: { type: "hangoutsMeet" }, name: "Google Meet" },
    entryPoints: [
      { entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij", label: "meet.google.com/abc-defg-hij" },
      { entryPointType: "phone", uri: "tel:+1-415-555-0161", label: "+1 415-555-0161", pin: "264326521", regionCode: "US" },
      { entryPointType: "more", uri: "https://tel.meet/abc-defg-hij?pin=264326521" },
    ],
  },
});

export const GRAPH_CREATED_WITH_TEAMS = (subject: string, start: string, end: string) => ({
  id: "AAMkAD_evt_teams1", subject, start: { dateTime: start, timeZone: "UTC" }, end: { dateTime: end, timeZone: "UTC" }, onlineMeetingProvider: "teamsForBusiness",
  organizer: { emailAddress: { address: "maya@vyre.test" } }, attendees: [{ email: "pat@client.test", response: "none" }],
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_NjA4%40thread.v2/0", conferenceId: "482991733", tollNumber: "+1 323-555-0144" },
});

export const ZOOM_MEETING = { id: "84512345678", topic: "Lease call", joinUrl: "https://us02web.zoom.us/j/84512345678?pwd=Q2x", password: "551203", dialIns: [{ number: "+1 669 444 9171", country: "US" }, { number: "+1 646 931 3860", country: "US" }] };
