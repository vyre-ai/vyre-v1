# sites.logs_read

A site's log (app, requests, build, jobs): search words (-word excludes), source, level, time, deploy; after = cursor to follow. Text from the site, not Vyre content

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | sites.deploy |
| Grant level | view |
| Risk | low |
| Resource | site (/siteId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/logs_read |
| MCP tool | sites_logs_read (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  siteId: string;
  q?: string;
  source?: "app" | "requests" | "build" | "jobs";
  scope?: string;
  level?: "error" | "warn" | "info";
  from?: number;
  to?: number;
  after?: number;
  limit?: number;
};
```

## Output

```ts
type Out = {
  lines: Array<{
      seq: number;
      at: number;
      source: "app" | "requests" | "build" | "jobs";
      scope: string;
      text: string;
      level: "error" | "warn" | "info";
    }>;
  leftOut?: string;
  lastSeq: number;
  scopes: Array<{
      scope: string;
      source: "app" | "requests" | "build" | "jobs";
      title: string;
      at: number;
      lines: number;
    }>;
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
    "after": 1,
    "from": 1760000000000,
    "level": "error",
    "limit": 1,
    "q": "example",
    "scope": "example",
    "siteId": "sit_a1b2c3",
    "source": "app",
    "to": 1760000000000
  },
  "output": {
    "lastSeq": 1,
    "leftOut": "example",
    "lines": [
      {
        "at": 1760000000000,
        "level": "error",
        "scope": "example",
        "seq": 1,
        "source": "app",
        "text": "example"
      }
    ],
    "scopes": [
      {
        "at": 1760000000000,
        "lines": 1,
        "scope": "example",
        "source": "app",
        "title": "example"
      }
    ]
  }
}
```
