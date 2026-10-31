# sync_types.status

The Sync page of a synced type: last pass, counts, failures, pushes waiting, whether a first-pull filter still holds, and the next poll

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
| HTTP | POST /v1/sync_types/status |
| MCP tool | sync_types_status (records) |
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
  type: string;
  app: {
    key: string;
    title: string;
    domain?: string;
  };
  state: "initial" | "syncing" | "paused" | "needs_review" | "error";
  paused: boolean;
  deletes: "off" | "soft" | "travel";
  conflict: "newest" | "source" | "vyre" | "ask";
  account?: string;
  accounts?: Array<{
      account: string;
      state: string;
      records: number;
      estimate?: number;
      pending: number;
    }>;
  polling: {
    activeSec: number;
    idleSec: number;
    dormantSec: number;
  };
  records: number;
  estimate?: number;
  filter?: string;
  canBackfill: boolean;
  lastRun?: {
    at: number;
    summary: string;
  };
  pending: number;
  failedPushes: number;
  conflicts: number;
  schemaChanges: number;
  failures: Array<{
      at: number;
      summary: string;
    }>;
  sentToday: number;
  nextPollAt?: number;
  spec: boolean;
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
    "account": "example",
    "accounts": [
      {
        "account": "example",
        "estimate": 1,
        "pending": 1,
        "records": 1,
        "state": "example"
      }
    ],
    "app": {
      "domain": "example",
      "key": "hubspot",
      "title": "example"
    },
    "canBackfill": true,
    "conflict": "newest",
    "conflicts": 1,
    "deletes": "off",
    "estimate": 1,
    "failedPushes": 1,
    "failures": [
      {
        "at": 1760000000000,
        "summary": "example"
      }
    ],
    "filter": "example",
    "lastRun": {
      "at": 1760000000000,
      "summary": "example"
    },
    "nextPollAt": 1760000000000,
    "paused": true,
    "pending": 1,
    "polling": {
      "activeSec": 30,
      "dormantSec": 300,
      "idleSec": 60
    },
    "records": 1,
    "schemaChanges": 1,
    "sentToday": 1,
    "spec": true,
    "state": "initial",
    "type": "contact"
  }
}
```
