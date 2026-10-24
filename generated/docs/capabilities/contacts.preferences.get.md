# contacts.preferences.get

Read the Contact preferences group of a contact

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/contactId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/contacts/preferences/get |
| MCP tool | contacts_preferences_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  contactId: string;
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
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "contactId": "rec_a1b2c3"
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
