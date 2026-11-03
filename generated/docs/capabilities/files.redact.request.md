# files.redact.request

Ask a person to review a file in a Redacted folder before you read it (Redact before I can read); you are woken when it is ready

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/redact/request |
| MCP tool | files_ask_to_read (files) |
| CLI | none |
| Emits | file.redact_requested |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  requestId: string | null;
  state: "clear" | "redacted" | "needs" | "off";
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
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "requestId": "rrq_a1b2c3",
    "state": "clear"
  }
}
```
