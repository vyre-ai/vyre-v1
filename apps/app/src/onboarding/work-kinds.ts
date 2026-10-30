// The kinds of work and the tools a person can type a few letters of in "How you work" (type-ahead, free text always allowed). Broad on purpose, across industries; the list is examples,
// not a limit, because anything typed is accepted.
export const ROLES: readonly string[] = "Accountant|Tax preparer|Bookkeeper|CPA|Auditor|Financial advisor|Wealth manager|Insurance agent|Mortgage broker|Loan officer|Attorney|Paralegal|Legal assistant|Legal secretary|Law firm partner|Associate attorney|In-house counsel|Compliance officer|Patent agent|Notary|Mediator|Immigration specialist|Estate planner|Probate specialist|Personal injury attorney|Family law attorney|Criminal defense attorney|Consultant|Management consultant|Business coach|Executive coach|Strategist|Project manager|Program manager|Product manager|Operations manager|Office manager|Executive assistant|Virtual assistant|Administrative assistant|Receptionist|Customer support|Customer success manager|Account manager|Account executive|Sales rep|Sales manager|Business development|Recruiter|Talent partner|HR manager|People operations|Payroll specialist|Designer|Graphic designer|Product designer|UX designer|Brand designer|Interior designer|Architect|Landscape architect|Illustrator|Photographer|Videographer|Video editor|Animator|Copywriter|Content writer|Editor|Journalist|Author|Translator|Podcaster|Social media manager|Marketer|Marketing manager|SEO specialist|Growth marketer|Performance marketer|Email marketer|PR specialist|Event planner|Community manager|Developer|Software engineer|Frontend developer|Backend developer|Full-stack developer|Mobile developer|DevOps engineer|Data engineer|Data scientist|Data analyst|Machine learning engineer|QA engineer|Security engineer|IT administrator|Systems administrator|Technical writer|Solutions engineer|Founder|Co-founder|CEO|COO|CFO|CTO|Chief of staff|Investor|Venture capitalist|Real estate agent|Real estate broker|Property manager|Appraiser|Home inspector|Contractor|General contractor|Electrician|Plumber|HVAC technician|Builder|Surveyor|Civil engineer|Mechanical engineer|Electrical engineer|Doctor|Physician|Nurse|Nurse practitioner|Dentist|Dental hygienist|Therapist|Psychologist|Counselor|Social worker|Chiropractor|Physical therapist|Pharmacist|Veterinarian|Medical biller|Practice manager|Teacher|Professor|Tutor|Instructor|Principal|Researcher|Scientist|Lab technician|Librarian|Nonprofit director|Fundraiser|Grant writer|Policy analyst|Government employee|Military veteran|Restaurant owner|Chef|Hotel manager|Travel agent|Retail owner|E-commerce seller|Logistics coordinator|Supply chain manager|Buyer|Procurement manager|Farmer|Fitness coach|Personal trainer|Salon owner|Stylist|Musician|Artist|Actor|Producer|Agent|Student|Freelancer|Solo operator|Owner operator".split("|");

/** [name, logo key]: a tool with a mark in ProviderLogo shows it; the rest show their first letter. */
export const TOOLS: readonly (readonly [string, string])[] = [
  ["Gmail", "gmail"],
  ["Slack", "slack"],
  ["Notion", "notion"],
  ["GitHub", "github"],
  ["Google Calendar", "googlecalendar"],
  ["Google Drive", "googledrive"],
  ["Linear", "linear"],
  ["Figma", "figma"],
  ["Jira", "jira"],
  ["Asana", "asana"],
  ["Trello", "trello"],
  ["HubSpot", "hubspot"],
  ["Salesforce", "salesforce"],
  ["QuickBooks", "quickbooks"],
  ["Stripe", "stripe"],
  ["Zoom", "zoom"],
  ["Outlook", "microsoftoutlook"],
  ["Microsoft Teams", "microsoftteams"],
  ["Google Sheets", "googlesheets"],
  ["Airtable", "airtable"],
  ["Zapier", "zapier"],
  ["Shopify", "shopify"],
  ["WordPress", "wordpress"],
  ["Canva", "canva"],
  ["Xero", "xero"],
  ..."Excel|Word|PowerPoint|Google Docs|Dropbox|Box|DocuSign|Clio|Lawmatics|Filevine|MyCase|Calendly|Loom|Miro|Monday|ClickUp|Basecamp|Intercom|Zendesk|Mailchimp|Klaviyo|Meta Ads|Google Ads|LinkedIn|Webflow|Squarespace|Wix|Gusto|Rippling|Bill.com|Expensify|Ramp|Brex|Plaid|AWS|Vercel|Railway|Supabase|Postgres|Snowflake|Looker|Tableau|Power BI|Obsidian|Evernote|Telegram|WhatsApp|Discord|iMessage|Twilio".split("|").map((n): readonly [string, string] => [n, ""]),
];

/** The best matches for what was typed: names that start with it first, then names that contain it; what is already picked is left out. */
export function suggest<T extends string | readonly [string, string]>(list: readonly T[], typed: string, have: readonly string[], limit = 6): T[] {
  const t = typed.trim().toLowerCase();
  if (t === "") return [];
  const name = (x: T): string => (typeof x === "string" ? x : x[0]);
  const free = list.filter((x) => !have.includes(name(x)));
  const head = free.filter((x) => name(x).toLowerCase().startsWith(t));
  const rest = free.filter((x) => !name(x).toLowerCase().startsWith(t) && name(x).toLowerCase().includes(t));
  return head.concat(rest).slice(0, limit);
}
