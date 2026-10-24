# campaigns.get

Read a campaign with steps, audience, windows, throttle and A/B variants

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | campaign (/campaignId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/campaigns/get |
| MCP tool | campaigns_get (automations) |
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
  steps: Array<{
      key: string;
      type: "email" | "wait" | "branch" | "sms" | "task" | "call_task";
      config: Record<string, unknown>;
      next?: Array<string>;
    }>;
  audienceViewId?: string;
  windows?: unknown;
  throttle?: unknown;
  variants?: unknown;
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
    "campaignId": "cmp_a1b2c3"
  },
  "output": {
    "audienceViewId": "example",
    "campaign": {
      "audienceCount": 1,
      "campaignId": "cmp_a1b2c3",
      "kind": "one_time",
      "name": "example",
      "owner": "usr_a1b2c3",
      "replies": 1,
      "sent": 1,
      "state": "draft"
    },
    "steps": [
      {
        "config": {},
        "key": "example",
        "next": [
          "example"
        ],
        "type": "email"
      }
    ],
    "throttle": {},
    "variants": {},
    "windows": {}
  }
}
```
