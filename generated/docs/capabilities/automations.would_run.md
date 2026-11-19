# automations.would_run

How often it would have started last week

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | automation (/automationId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/would_run |
| MCP tool | automations_would_run (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
  draft?: boolean;
};
```

## Output

```ts
type Out = {
  supported: boolean;
  days: number;
  n: number;
  of: number;
  capped: boolean;
  what?: string;
  noun?: string;
  starts: Array<{
      eventId: string;
      at: number;
      starts: boolean;
      name: string;
      change: string;
      why?: string;
      recordId?: string;
      type?: string;
    }>;
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
    "automationId": "aut_a1b2c3",
    "draft": true
  },
  "output": {
    "capped": true,
    "days": 1,
    "n": 1,
    "noun": "example",
    "of": 1,
    "starts": [
      {
        "at": 1760000000000,
        "change": "example",
        "eventId": "evt_a1b2c3",
        "name": "example",
        "recordId": "rec_a1b2c3",
        "starts": true,
        "type": "contact",
        "why": "example"
      }
    ],
    "supported": true,
    "what": "example"
  }
}
```
