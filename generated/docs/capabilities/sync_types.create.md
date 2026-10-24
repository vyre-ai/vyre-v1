# sync_types.create

Bind a record type (new or existing) to a remote object with field directions, match rule and conflict rule

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/sync_types/create |
| MCP tool | sync_types_create (engineer) |
| CLI | none |
| Emits | sync.type_bound, schema.changed |

## Input

```ts
type In = {
  type: string;
  connectionId: string;
  remote: string;
  fields: Array<{
      key: string;
      remote: string;
      dir: "pull" | "push" | "both" | "off";
      transform?: string;
    }>;
  match: Array<string>;
  createAtSource?: boolean;
  deletes?: "off" | "soft" | "travel";
  conflict?: "newest" | "source" | "vyre" | "ask";
  polling?: {
    activeSec: number;
    idleSec: number;
    dormantSec: number;
  };
  nightlyReconcile?: boolean;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  syncedType: {
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
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate

## Example

```json
{
  "name": "example",
  "input": {
    "conflict": "newest",
    "connectionId": "con_a1b2c3",
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
    "idempotencyKey": "idem_1",
    "match": [
      "email"
    ],
    "nightlyReconcile": true,
    "polling": {
      "activeSec": 30,
      "dormantSec": 300,
      "idleSec": 60
    },
    "remote": "contacts",
    "type": "contact"
  },
  "output": {
    "syncedType": {
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
  }
}
```
