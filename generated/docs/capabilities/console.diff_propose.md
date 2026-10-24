# console.diff_propose

Record a proposed change as a diff card (nothing is applied)

| | |
|---|---|
| Module | console-assistant |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | console.access |
| Grant level | edit |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/diff_propose |
| MCP tool | console_diff_propose (engineer) |
| CLI | none |
| Emits | console.change_proposed |

## Input

```ts
type In = {
  threadId: string;
  diff: {
    diffId: string;
    kind: "role" | "grant" | "schema" | "policy" | "setting" | "connector" | "config";
    title: string;
    changes: Array<{
        path: string;
        before: unknown;
        after: unknown;
      }>;
    affects?: string;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  diffId: string;
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
    "diff": {
      "affects": "example",
      "changes": [
        {
          "after": {},
          "before": {},
          "path": "example"
        }
      ],
      "diffId": "dif_a1b2c3",
      "kind": "role",
      "title": "example"
    },
    "idempotencyKey": "idem_1",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "diffId": "dif_a1b2c3"
  }
}
```
