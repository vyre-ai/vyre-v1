# campaigns.stop

Stop a campaign for good

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | campaigns.launch |
| Grant level | manage |
| Risk | medium |
| Resource | campaign (/campaignId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/campaigns/stop |
| MCP tool | campaigns_stop (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  campaignId: string;
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
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "campaignId": "cmp_a1b2c3"
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
