# notifications.rules.get

My notification settings: working hours, email backstop, muted agents, channels and records

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/rules/get |
| MCP tool | notifications_rules_get (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  rules: {
    workingHours?: {
      days: Array<number>;
      from: string;
      to: string;
      tz: string;
    };
    emailBackstop: boolean;
    mutedAgents: Array<string>;
    mutedChannels: Array<string>;
    mutedRecords: Array<string>;
  };
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
  "input": {},
  "output": {
    "rules": {
      "emailBackstop": true,
      "mutedAgents": [
        "agt_a1b2c3"
      ],
      "mutedChannels": [
        "chn_a1b2c3"
      ],
      "mutedRecords": [
        "rec_a1b2c3"
      ],
      "workingHours": {
        "days": [
          1
        ],
        "from": "09:00",
        "to": "18:00",
        "tz": "Asia/Karachi"
      }
    }
  }
}
```
