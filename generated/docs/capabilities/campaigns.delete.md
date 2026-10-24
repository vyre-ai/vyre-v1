# campaigns.delete

Delete a draft campaign

| | |
|---|---|
| Module | campaigns |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.space |
| Grant level | manage |
| Risk | medium |
| Resource | campaign (/campaignId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/campaigns/delete |
| MCP tool | campaigns_delete (automations) |
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
  deleted: boolean;
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
    "deleted": true
  }
}
```
