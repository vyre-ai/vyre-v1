# notifications.rules.set

Adjust my notification settings (settings only adjusts; nothing is required)

| | |
|---|---|
| Module | notifications |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notifications/rules/set |
| MCP tool | notifications_rules_set (meta) |
| CLI | none |
| Emits | notification.rules_changed |

## Input

```ts
type In = {
  workingHours?: {
    days: Array<number>;
    from: string;
    to: string;
    tz: string;
  } | null;
  emailBackstop?: boolean;
  mutedAgents?: Array<string>;
  mutedChannels?: Array<string>;
  mutedRecords?: Array<string>;
};
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
  "input": {
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
  },
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
