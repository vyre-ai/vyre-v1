# runbooks.set_target

Save where a runbook runs (the Runs on bar)

| | |
|---|---|
| Module | runbooks |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/runbooks/set_target |
| MCP tool | runbooks_set_target (terminal) |
| CLI | none |
| Emits | runbook.target_set |

## Input

```ts
type In = {
  fileId: string;
  target: {
    kind: "server" | "computer";
    computerId?: string;
  };
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
    "fileId": "fil_a1b2c3",
    "target": {
      "computerId": "cmt_a1b2c3",
      "kind": "server"
    }
  },
  "output": {
    "ok": true
  }
}
```
