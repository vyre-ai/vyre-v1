# previews.render

Make or remake the preview of a file version (system; also run by the consumer after every new version)

| | |
|---|---|
| Module | previews |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/previews/render |
| MCP tool | none |
| CLI | none |
| Emits | preview.ready, preview.failed |

## Input

```ts
type In = {
  fileId: string;
  versionId?: string;
  force?: boolean;
};
```

## Output

```ts
type Out = {
  queued: boolean;
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
    "fileId": "fil_a1b2c3",
    "force": true,
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "queued": true
  }
}
```
