# files.review

Mark a file reviewed for AI (Done): agents may read its redacted version, and every agent that asked is woken

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
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/review |
| MCP tool | none |
| CLI | none |
| Emits | file.reviewed, file.redact_ready, file.needs_review |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  reviewed: {
    by: string;
    at: number;
    version: number;
  };
  woke: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "reviewed": {
      "at": 1760000000000,
      "by": "example",
      "version": 1
    },
    "woke": 1
  }
}
```
