# contacts.dnd_screen

Screen candidates before they are ADDED to an audience, campaign, Journey enrolment or import. Adds only: it never removes, unsubscribes or deletes anyone already present

| | |
|---|---|
| Module | contacts-link |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/contacts/dnd_screen |
| MCP tool | contacts_dnd_screen (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  context: "audience" | "campaign" | "journey_enrol" | "import";
  contextId?: string;
  candidates: Array<{
      ref: string;
      contactId?: string;
      email?: string;
      phone?: string;
    }>;
};
```

## Output

```ts
type Out = {
  allowed: Array<string>;
  refused: Array<{
      ref: string;
      reason: "bounce_hard" | "complaint" | "unsubscribe" | "stop" | "manual" | "do_not_contact" | "import";
    }>;
  removed: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "candidates": [
      {
        "contactId": "rec_a1b2c3",
        "email": "example",
        "phone": "+14155550123",
        "ref": "example"
      }
    ],
    "context": "audience",
    "contextId": "example"
  },
  "output": {
    "allowed": [
      "ref_1"
    ],
    "refused": [
      {
        "ref": "ref_2",
        "reason": "do_not_contact"
      }
    ],
    "removed": 0
  }
}
```
