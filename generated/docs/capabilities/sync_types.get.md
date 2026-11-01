# sync_types.get

Read the sync binding of a record type (the header line, mapping and rules)

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record_type (/type) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/get |
| MCP tool | sync_types_get (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  account?: string;
};
```

## Output

```ts
type Out = {
  syncedType: {
    syncTypeId: string;
    type: string;
    account?: string;
    connector: string;
    connectionId: string;
    remote: string;
    state: "initial" | "syncing" | "paused" | "needs_review" | "error";
    fields: Array<{
        key: string;
        remote: string;
        dir: "pull" | "push" | "both" | "off";
        transform?: string;
        relation?: string;
        inverse?: string;
        constant?: string;
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
    app?: {
      title: string;
      domain?: string;
    };
  };
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
    "account": "example",
    "type": "contact"
  },
  "output": {
    "syncedType": {
      "account": "example",
      "app": {
        "domain": "example",
        "title": "example"
      },
      "conflict": "newest",
      "conflicts": 1,
      "connectionId": "con_a1b2c3",
      "connector": "hubspot",
      "createAtSource": true,
      "deletes": "off",
      "fields": [
        {
          "constant": "example",
          "dir": "pull",
          "inverse": "email",
          "key": "email",
          "relation": "contact",
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
