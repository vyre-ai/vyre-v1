# campaigns.stats

Sent, delivered, bounced, complained, replied, unsubscribed

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
| HTTP | POST /v1/campaigns/stats |
| MCP tool | campaigns_stats (automations) |
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
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  replied: number;
  unsubscribed: number;
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
    "bounced": 1,
    "complained": 1,
    "delivered": 1,
    "replied": 1,
    "sent": 1,
    "unsubscribed": 1
  }
}
```
