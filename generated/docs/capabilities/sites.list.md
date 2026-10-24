# sites.list

List sites by section (Personal, Shared with me, Space) and folder

| | |
|---|---|
| Module | sites |
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
| HTTP | POST /v1/sites/list |
| MCP tool | sites_list (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folderId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  sites: Array<{
      siteId: string;
      name: string;
      kind: "site" | "app" | "api" | "worker" | "artifact";
      owner: string;
      repoFolderId?: string;
      stagingUrl?: string;
      productionUrl?: string;
      state: "queued" | "building" | "ready" | "failed" | "stopped";
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
    "folderId": "fld_a1b2c3",
    "limit": 1,
    "section": "personal"
  },
  "output": {
    "next": "example",
    "sites": [
      {
        "kind": "site",
        "name": "example",
        "owner": "example",
        "productionUrl": "example",
        "repoFolderId": "fld_a1b2c3",
        "siteId": "sit_a1b2c3",
        "stagingUrl": "example",
        "state": "queued"
      }
    ],
    "total": 1
  }
}
```
