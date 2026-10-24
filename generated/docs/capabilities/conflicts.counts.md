# conflicts.counts

Counts of open, needs-you and resolved conflicts for the sync status line

| | |
|---|---|
| Module | conflicts |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/conflicts/counts |
| MCP tool | conflicts_counts (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  open: number;
  needsYou: number;
  resolved: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {},
  "output": {
    "needsYou": 1,
    "open": 1,
    "resolved": 1
  }
}
```
