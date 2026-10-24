# campaigns.schedule_set

Set send windows per recipient time zone, throttling per sending domain and stop on reply

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
| HTTP | POST /v1/campaigns/schedule_set |
| MCP tool | campaigns_schedule_set (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  campaignId: string;
  windows: unknown;
  throttlePerHour?: number;
  stopOnReply: boolean;
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
    "stopOnReply": true,
    "throttlePerHour": 1,
    "windows": {}
  },
  "output": {
    "ok": true
  }
}
```
