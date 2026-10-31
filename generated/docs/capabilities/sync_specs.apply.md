# sync_specs.apply

Apply a validated SyncSpec: a live connector (with its own tests), a connection holding the Vault handle, the record types with fields, choices, relations and stages, the synced-type bindings, and the first pull

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
| HTTP | POST /v1/sync_specs/apply |
| MCP tool | sync_specs_apply (records) |
| CLI | vyre sync-spec apply |
| Emits | connector.created, connector.published, connection.created, sync.type_bound, schema.changed |

## Input

```ts
type In = {
  spec: {
    app: {
      name: string;
      domain: string;
      docsUrl?: string;
      logoHint?: string;
      account?: string;
    };
    auth: {
      vaultHandle: string;
      style: "bearer" | "header" | "basic" | "query" | "oauth";
      header?: string;
      prefix?: string;
      headers?: Record<string, string>;
    };
    objects: Array<{
        remote: string;
        label: string;
        count?: number;
        list: {
          path: string;
          query?: Record<string, string>;
          cursor?: {
            kind: "none" | "page" | "cursor" | "offset" | "link";
            param?: string;
            next?: string;
            size?: number;
            sizeParam?: string;
            start?: number;
          };
          updatedSince?: {
            param: string;
            format?: string;
          };
          filter?: {
            param: string;
            value: string;
          };
        };
        get?: {
          path: string;
        };
        create?: {
          path: string;
          method?: "POST" | "PUT" | "PATCH" | "DELETE";
          evidence: string;
          bodyAt?: string;
          idAt?: string;
        };
        update?: {
          path: string;
          method?: "POST" | "PUT" | "PATCH" | "DELETE";
          evidence: string;
          bodyAt?: string;
          idAt?: string;
        };
        delete?: {
          path: string;
          method?: "POST" | "PUT" | "PATCH" | "DELETE";
          evidence: string;
          bodyAt?: string;
          idAt?: string;
        };
        id: string;
        updatedAt?: string;
        itemsAt: string;
        openUrl?: string;
        fields: Array<{
            path: string;
            label: string;
            type: "text" | "number" | "money" | "date" | "bool" | "choice" | "multi" | "email" | "phone" | "url" | "relation" | "json";
            choices?: Array<{
                value: string;
                label?: string;
              }>;
            relationTo?: string;
            readOnly?: boolean;
          }>;
        webhook?: {
          events: Array<string>;
          subscribePath?: string;
          evidence?: string;
          manualUrl?: boolean;
          signature?: string;
        };
      }>;
    mapping: Array<{
        remote: string;
        recordType: string;
        title?: string;
        fields: Array<{
            path: string;
            field?: string;
            direction: "both" | "pull" | "push" | "off";
          }>;
        match?: Array<string>;
        stagesFrom?: string;
        titleField?: string;
        deletes?: "off" | "soft" | "travel";
        createAtSource?: boolean;
      }>;
    plan: {
      firstPull: {
        words: string;
      };
      backfill: "later" | "now";
      conflicts: "newest";
    };
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  connector: string;
  connectionId: string;
  version: string;
  types: Array<{
      type: string;
      syncTypeId: string;
      runId?: string;
    }>;
  live: "polling" | "webhook";
  webhookUrl?: string;
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.duplicate
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "spec": {
      "app": {
        "account": "example",
        "docsUrl": "example",
        "domain": "api.example.com",
        "logoHint": "example",
        "name": "example"
      },
      "auth": {
        "header": "example",
        "headers": {},
        "prefix": "example",
        "style": "bearer",
        "vaultHandle": "#Dana_Lawmatics"
      },
      "mapping": [
        {
          "createAtSource": true,
          "deletes": "off",
          "fields": [
            {
              "direction": "both",
              "field": "email",
              "path": "/id"
            }
          ],
          "match": [
            "/id"
          ],
          "recordType": "contact",
          "remote": "example",
          "stagesFrom": "/id",
          "title": "example",
          "titleField": "/id"
        }
      ],
      "objects": [
        {
          "count": 1,
          "create": {
            "bodyAt": "example",
            "evidence": "example",
            "idAt": "/id",
            "method": "POST",
            "path": "/contacts/{id}"
          },
          "delete": {
            "bodyAt": "example",
            "evidence": "example",
            "idAt": "/id",
            "method": "POST",
            "path": "/contacts/{id}"
          },
          "fields": [
            {
              "choices": [
                {
                  "value": "lead",
                  "label": "Lead"
                }
              ],
              "label": "example",
              "path": "/id",
              "readOnly": true,
              "relationTo": "example",
              "type": "text"
            }
          ],
          "get": {
            "path": "example"
          },
          "id": "/id",
          "itemsAt": "/id",
          "label": "example",
          "list": {
            "cursor": {
              "kind": "none",
              "next": "/id",
              "param": "example",
              "size": 1,
              "sizeParam": "example",
              "start": 1
            },
            "filter": {
              "param": "example",
              "value": "example"
            },
            "path": "/contacts",
            "query": {},
            "updatedSince": {
              "format": "example",
              "param": "example"
            }
          },
          "openUrl": "example",
          "remote": "example",
          "update": {
            "bodyAt": "example",
            "evidence": "example",
            "idAt": "/id",
            "method": "POST",
            "path": "/contacts/{id}"
          },
          "updatedAt": "/id",
          "webhook": {
            "events": [
              "example"
            ],
            "evidence": "example",
            "manualUrl": true,
            "signature": "example",
            "subscribePath": "example"
          }
        }
      ],
      "plan": {
        "backfill": "later",
        "conflicts": "newest",
        "firstPull": {
          "words": "example"
        }
      }
    }
  },
  "output": {
    "connectionId": "con_a1b2c3",
    "connector": "hubspot",
    "live": "polling",
    "types": [
      {
        "runId": "run_a1b2c3",
        "syncTypeId": "syt_a1b2c3",
        "type": "contact"
      }
    ],
    "version": "example",
    "webhookUrl": "example"
  }
}
```
