# runbooks.list

List runbook files (markdown with fenced shell blocks) the caller can open

| | |
|---|---|
| Module | runbooks |
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
| HTTP | POST /v1/runbooks/list |
| MCP tool | runbooks_list (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folder?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  runbooks: Array<{
      fileId: string;
      name: string;
      folderId: string;
      blocks: number;
      lastRunAt?: number;
      lastState?: "queued" | "running" | "succeeded" | "failed" | "stopped";
    }>;
  next?: string;
  total?: number;
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
  "input": {
    "cursor": "example",
    "folder": "fld_a1b2c3",
    "limit": 1
  },
  "output": {
    "next": "example",
    "runbooks": [
      {
        "blocks": 1,
        "fileId": "fil_a1b2c3",
        "folderId": "fld_a1b2c3",
        "lastRunAt": 1760000000000,
        "lastState": "queued",
        "name": "example"
      }
    ],
    "total": 1
  }
}
```
