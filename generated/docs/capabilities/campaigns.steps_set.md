# campaigns.steps_set

Replace the steps: email, wait, branch on reply/open/click, SMS, task, call task

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.space |
| Grant level | edit |
| Risk | medium |
| Resource | campaign (/campaignId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/campaigns/steps_set |
| MCP tool | campaigns_steps_set (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  campaignId: string;
  steps: Array<{
      key: string;
      type: "email" | "wait" | "branch" | "sms" | "task" | "call_task";
      config: Record<string, unknown>;
      next?: Array<string>;
    }>;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "campaignId": "cmp_a1b2c3",
    "steps": [
      {
        "config": {},
        "key": "example",
        "next": [
          "example"
        ],
        "type": "email"
      }
    ]
  },
  "output": {
    "ok": true
  }
}
```
