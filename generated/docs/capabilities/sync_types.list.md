# sync_types.list

List synced types with state, pending pushes, conflicts and schema changes

| | |
|---|---|
| Module | connectors |
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
| HTTP | POST /v1/sync_types/list |
| MCP tool | sync_types_list (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connector?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  syncedTypes: Array<{
      syncTypeId: string;
      type: string;
      connector: string;
      connectionId: string;
      remote: string;
      state: "initial" | "syncing" | "paused" | "needs_review" | "error";
      fields: Array<{
          key: string;
          remote: string;
          dir: "pull" | "push" | "both" | "off";
          transform?: string;
        }>;
      match: Array<string>;
      createAtSource: boolean;
      deletes: "off" | "soft" | "travel";
      conflict: "newest" | "source" | "vyre" | "ask";
      polling: {
        activeSec: number;
        idleSec: number;
        dormantSec: number;
      };
      nightlyReconcile: boolean;
      lastSyncAt?: number;
      pending: number;
      conflicts: number;
      schemaChanges: number;
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
    "connector": "hubspot",
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "next": "example",
    "syncedTypes": [
      {
        "conflict": "newest",
        "conflicts": 1,
        "connectionId": "con_a1b2c3",
        "connector": "hubspot",
        "createAtSource": true,
        "deletes": "off",
        "fields": [
          {
            "dir": "pull",
            "key": "email",
            "remote": "example",
            "transform": "example"
          }
        ],
        "lastSyncAt": 1760000000000,
        "match": [
          "email"
        ],
        "nightlyReconcile": true,
        "pending": 1,
        "polling": {
          "activeSec": 30,
          "dormantSec": 300,
          "idleSec": 60
        },
        "remote": "example",
        "schemaChanges": 1,
        "state": "initial",
        "syncTypeId": "syt_a1b2c3",
        "type": "contact"
      }
    ],
    "total": 1
  }
}
```
