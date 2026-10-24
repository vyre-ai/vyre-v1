# mounts.browse

Browse a drive, library or repository search to pick what to mount

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
| HTTP | POST /v1/mounts/browse |
| MCP tool | mounts_browse (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind: "google_drive" | "sharepoint" | "onedrive" | "local" | "github";
  connectionId?: string;
  parent?: string;
  q?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  items: Array<{
      ref: string;
      name: string;
      isFolder: boolean;
      path?: string;
      shared?: boolean;
    }>;
  next?: string;
  total?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "cursor": "example",
    "kind": "google_drive",
    "limit": 1,
    "parent": "example",
    "q": "example"
  },
  "output": {
    "items": [
      {
        "isFolder": true,
        "name": "example",
        "path": "example",
        "ref": "example",
        "shared": true
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
