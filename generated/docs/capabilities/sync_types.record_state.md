# sync_types.record_state

Where one record came from and how each of its synced fields is doing: saved, saving, failed or only here, with the address to open it in the app

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_types/record_state |
| MCP tool | sync_types_record_state (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
};
```

## Output

```ts
type Out = {
  synced: boolean;
  state: "synced" | "saving" | "failed" | "local";
  lastSyncAt?: number;
  remoteId?: string;
  openUrl?: string;
  app?: {
    key: string;
    title: string;
    domain?: string;
  };
  fields: Array<{
      key: string;
      dir: "pull" | "push" | "both" | "off";
      state: "synced" | "saving" | "failed" | "local";
      at?: number;
      error?: string;
      outboxId?: string;
      history: number;
    }>;
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
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "app": {
      "domain": "example",
      "key": "hubspot",
      "title": "example"
    },
    "fields": [
      {
        "at": 1760000000000,
        "dir": "pull",
        "error": "example",
        "history": 1,
        "key": "email",
        "outboxId": "obx_a1b2c3",
        "state": "synced"
      }
    ],
    "lastSyncAt": 1760000000000,
    "openUrl": "example",
    "remoteId": "example",
    "state": "synced",
    "synced": true
  }
}
```
