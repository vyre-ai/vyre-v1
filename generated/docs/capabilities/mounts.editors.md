# mounts.editors

Who last edited each file at the provider, for the rows of a file list (files outside a mount are left out)

| | |
|---|---|
| Module | mounts |
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
| HTTP | POST /v1/mounts/editors |
| MCP tool | mounts_editors (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileIds: Array<string>;
};
```

## Output

```ts
type Out = {
  editors: Array<{
      fileId: string;
      provider: string;
      name?: string;
      email?: string;
      at?: number;
    }>;
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
    "fileIds": [
      "fil_a1b2c3"
    ]
  },
  "output": {
    "editors": [
      {
        "at": 1760000000000,
        "email": "example",
        "fileId": "fil_a1b2c3",
        "name": "example",
        "provider": "example"
      }
    ]
  }
}
```
