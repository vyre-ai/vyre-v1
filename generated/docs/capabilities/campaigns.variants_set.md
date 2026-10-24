# campaigns.variants_set

Set A/B variants

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
| HTTP | POST /v1/campaigns/variants_set |
| MCP tool | campaigns_variants_set (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  campaignId: string;
  variants: Array<{
      key: string;
      weight: number;
      stepKey: string;
      config: Record<string, unknown>;
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
    "variants": [
      {
        "config": {},
        "key": "example",
        "stepKey": "example",
        "weight": 1
      }
    ]
  },
  "output": {
    "ok": true
  }
}
```
