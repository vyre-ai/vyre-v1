# automations.alerts.get

Read error alerts: who, when and where, and the escalation chain

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
| HTTP | POST /v1/automations/alerts/get |
| MCP tool | automations_alerts_get (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  automationId: string;
};
```

## Output

```ts
type Out = {
  alerts: {
    who: Array<{
        kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
        id: string;
      }>;
    when: {
      mode: "every" | "after_n";
      n?: number;
    };
    where: {
      needsYou: boolean;
      dm: boolean;
      channelId?: string;
    };
    escalation: Array<{
        to: {
          kind: "person" | "agent" | "actor" | "service" | "group" | "role" | "link";
          id: string;
        };
        afterHours: number;
      }>;
  };
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
    "automationId": "aut_a1b2c3"
  },
  "output": {
    "alerts": {
      "escalation": [
        {
          "afterHours": 1,
          "to": {
            "id": "usr_a1b2c3",
            "kind": "person"
          }
        }
      ],
      "when": {
        "mode": "every",
        "n": 2
      },
      "where": {
        "channelId": "chn_a1b2c3",
        "dm": true,
        "needsYou": true
      },
      "who": [
        {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      ]
    }
  }
}
```
