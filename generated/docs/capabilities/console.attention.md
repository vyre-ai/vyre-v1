# console.attention

Attention items: failing checks, expiring certificates, failed runs, stuck updates, hit limits

| | |
|---|---|
| Module | console-views |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | console.access |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/attention |
| MCP tool | console_attention (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  items: Array<{
      kind: "failing_check" | "expiring_certificate" | "failed_run" | "stuck_update" | "limit_hit" | "access_review_due";
      title: string;
      ref?: string;
      since: number;
      next: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "items": [
      {
        "kind": "failing_check",
        "next": "example",
        "ref": "example",
        "since": 1760000000000,
        "title": "example"
      }
    ]
  }
}
```
