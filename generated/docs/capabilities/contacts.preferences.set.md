# contacts.preferences.set

Set consent, Do-not-contact and channel opt-outs (source and time are stamped)

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | records.edit |
| Grant level | edit |
| Risk | medium |
| Resource | record (/contactId) |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/preferences/set |
| MCP tool | contacts_preferences_set (inbox) |
| CLI | none |
| Emits | contact.preferences_changed |

## Input

```ts
type In = {
  contactId: string;
  emailConsent?: "granted" | "denied" | "unknown";
  smsConsent?: "granted" | "denied" | "unknown";
  doNotContact?: boolean;
  optedOut?: Array<"email" | "sms" | "call">;
  source?: string;
};
```

## Output

```ts
type Out = {
  emailConsent: "granted" | "denied" | "unknown";
  smsConsent: "granted" | "denied" | "unknown";
  doNotContact: boolean;
  optedOut: Array<"email" | "sms" | "call">;
  source?: string;
  at?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "contactId": "rec_a1b2c3",
    "doNotContact": true,
    "emailConsent": "granted",
    "optedOut": [
      "email"
    ],
    "smsConsent": "granted",
    "source": "form"
  },
  "output": {
    "at": 1760000000000,
    "doNotContact": true,
    "emailConsent": "granted",
    "optedOut": [
      "email"
    ],
    "smsConsent": "granted",
    "source": "example"
  }
}
```
