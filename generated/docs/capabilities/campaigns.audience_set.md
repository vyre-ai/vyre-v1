# campaigns.audience_set

Set the audience from a record view; adds go through DND screening (adds only)

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
| HTTP | POST /v1/campaigns/audience_set |
| MCP tool | campaigns_audience_set (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  campaignId: string;
  type: string;
  viewId?: string;
  filter?: unknown;
};
```

## Output

```ts
type Out = {
  count: number;
  excluded: number;
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
    "filter": {},
    "type": "contact",
    "viewId": "example"
  },
  "output": {
    "count": 1,
    "excluded": 1
  }
}
```
