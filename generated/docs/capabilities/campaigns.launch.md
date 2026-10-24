# campaigns.launch

Launch a campaign (Gate act for agents, automations and humans alike)

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | campaigns.launch |
| Grant level | manage |
| Risk | high |
| Resource | campaign (/campaignId) |
| Gate | campaign_launch |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | yes |
| HTTP | POST /v1/campaigns/launch |
| MCP tool | campaigns_launch (automations) |
| CLI | none |
| Emits | campaign.launched |

## Input

```ts
type In = {
  campaignId: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  runId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.network
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "campaignId": "cmp_a1b2c3",
    "idempotencyKey": "idem_1"
  },
  "output": {
    "runId": "run_a1b2c3"
  }
}
```
