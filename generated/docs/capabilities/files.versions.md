# files.versions

List versions of a file with who and why

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/versions |
| MCP tool | files_versions (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  versions: Array<{
      versionId: string;
      n: number;
      by: string;
      at: number;
      reason?: string;
      name?: string;
    }>;
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
    "versions": [
      {
        "at": 1760000000000,
        "by": "example",
        "n": 1,
        "name": "example",
        "reason": "example",
        "versionId": "ver_a1b2c3"
      }
    ]
  }
}
```
