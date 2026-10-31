# sync_specs.preview

Dry run of a SyncSpec: the record types it would make, three sample records drawn from the real page, and what the first pull would bring in. Writes nothing to Vyre or to the app

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sync_specs/preview |
| MCP tool | sync_specs_preview (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  spec: {
    app: {
      name: string;
      domain: string;
      docsUrl?: string;
      logoHint?: string;
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
};
```

## Output

```ts
type Out = {
  ok: boolean;
  problems: Array<{
      level: "error" | "warn";
      at: string;
      message: string;
    }>;
  objects: Array<{
      remote: string;
      items: number;
      hasNext: boolean;
      fieldsFound: number;
      fieldsMissing: Array<string>;
      status: number;
    }>;
  summary: string;
  types: Array<{
      type: string;
      remote: string;
      isNew: boolean;
      title: string;
      existing: number;
      fields: Array<{
          key: string;
          label: string;
          type: string;
          dir: string;
        }>;
    }>;
  samples: Array<{
      type: string;
      remote: string;
      title: string;
      fields: Array<{
          key: string;
          label: string;
          value: unknown;
        }>;
    }>;
};
```

## Errors

- internal.unavailable
- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "spec": {
      "app": {
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
    "objects": [
      {
        "fieldsFound": 1,
        "fieldsMissing": [
          "example"
        ],
        "hasNext": true,
        "items": 1,
        "remote": "example",
        "status": 1
      }
    ],
    "ok": true,
    "problems": [
      {
        "at": "example",
        "level": "error",
        "message": "example"
      }
    ],
    "samples": [
      {
        "fields": [
          {
            "key": "email",
            "label": "example",
            "value": {}
          }
        ],
        "remote": "example",
        "title": "example",
        "type": "contact"
      }
    ],
    "summary": "example",
    "types": [
      {
        "existing": 1,
        "fields": [
          {
            "dir": "example",
            "key": "email",
            "label": "example",
            "type": "example"
          }
        ],
        "isNew": true,
        "remote": "example",
        "title": "example",
        "type": "contact"
      }
    ]
  }
}
```
