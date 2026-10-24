# campaigns.preview

Launch preview: a sample message, counts and exclusions

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
| HTTP | POST /v1/campaigns/preview |
| MCP tool | campaigns_preview (automations) |
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
  sample: {
    subject?: string;
    body: string;
  };
  counts: {
    audience: number;
    excluded: number;
    suppressed: number;
  };
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
    "counts": {
      "audience": 1,
      "excluded": 1,
      "suppressed": 1
    },
    "sample": {
      "body": "example",
      "subject": "example"
    }
  }
}
```
