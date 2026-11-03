# mounts.engine_folders

System: the folders on their own computers a person mounted into this Space (local mounts they added), with the path on the computer, for that person's CLI engine

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
| HTTP | POST /v1/mounts/engine_folders |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  person: string;
};
```

## Output

```ts
type Out = {
  folders: Array<{
      mountId: string;
      folderId: string;
      deviceId?: string;
      path: string;
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
    "person": "usr_a1b2c3"
  },
  "output": {
    "folders": [
      {
        "deviceId": "example",
        "folderId": "fld_a1b2c3",
        "mountId": "mnt_a1b2c3",
        "path": "/Users/dana/code/site"
      }
    ]
  }
}
```
