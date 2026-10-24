# campaigns.create

Create a campaign (one-time, sequence or triggered)

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.space |
| Grant level | edit |
| Risk | medium |
| Resource | campaign (create under /name) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/campaigns/create |
| MCP tool | campaigns_create (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
  kind: "one_time" | "sequence" | "triggered";
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  campaign: {
    campaignId: string;
    name: string;
    kind: "one_time" | "sequence" | "triggered";
    state: "draft" | "scheduled" | "running" | "paused" | "stopped" | "completed";
    owner: string;
    audienceCount: number;
    sent: number;
    replies: number;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "kind": "one_time",
    "name": "example"
  },
  "output": {
    "campaign": {
      "audienceCount": 1,
      "campaignId": "cmp_a1b2c3",
      "kind": "one_time",
      "name": "example",
      "owner": "usr_a1b2c3",
      "replies": 1,
      "sent": 1,
      "state": "draft"
    }
  }
}
```
