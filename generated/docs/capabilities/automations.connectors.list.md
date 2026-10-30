# automations.connectors.list

List the connectors written in this Space with their actions, triggers and levels (draft, tested, published). No key is included.

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/connectors/list |
| MCP tool | automations_connectors_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  connectors: Array<{
      app: string;
      title: string;
      docsUrl?: string;
      level: "draft" | "tested" | "published";
      domains: Array<string>;
      auth: {
        type: "api_key" | "bearer" | "basic" | "none";
        field?: string;
        userField?: string;
        header?: string;
        prefix?: string;
        query?: string;
      };
      vaultHandle?: string;
      owner: {
        kind: string;
        id: string;
      };
      actions: Array<{
          key: string;
          title: string;
          description?: string;
          method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
          path: string;
          effect: "read" | "outward";
          params: Array<{
              name: string;
              in: "path" | "query" | "header" | "body";
              required: boolean;
              type: "string" | "number" | "integer" | "boolean" | "object" | "array";
              description?: string;
            }>;
          output?: string;
          level: "draft" | "tested" | "published";
          stepKey: string;
        }>;
      triggers: Array<{
          key: string;
          title: string;
          kind: "poll" | "webhook";
          level: "draft" | "tested" | "published";
          action?: string;
          intervalSec?: number;
          polling?: {
            primed: boolean;
            fired: number;
            lastAt?: number;
            lastStatus?: number;
            lastError?: string;
            failures: number;
          };
          webhook?: {
            exists: boolean;
            lastDeliveryAt?: number;
            url?: string;
          };
        }>;
      updatedAt: number;
      publishedAt?: number;
    }>;
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
  "input": {},
  "output": {
    "connectors": [
      {
        "actions": [
          {
            "description": "example",
            "effect": "read",
            "key": "list_customers",
            "level": "draft",
            "method": "GET",
            "output": "example",
            "params": [
              {
                "description": "example",
                "in": "path",
                "name": "example",
                "required": true,
                "type": "string"
              }
            ],
            "path": "example",
            "stepKey": "example",
            "title": "example"
          }
        ],
        "app": "stripe",
        "auth": {
          "field": "example",
          "header": "example",
          "prefix": "example",
          "query": "example",
          "type": "api_key",
          "userField": "example"
        },
        "docsUrl": "example",
        "domains": [
          "example"
        ],
        "level": "draft",
        "owner": {
          "id": "example",
          "kind": "example"
        },
        "publishedAt": 1760000000000,
        "title": "example",
        "triggers": [
          {
            "action": "example",
            "intervalSec": 1,
            "key": "list_customers",
            "kind": "poll",
            "level": "draft",
            "polling": {
              "failures": 1,
              "fired": 1,
              "lastAt": 1760000000000,
              "lastError": "example",
              "lastStatus": 1,
              "primed": true
            },
            "title": "example",
            "webhook": {
              "exists": true,
              "lastDeliveryAt": 1760000000000,
              "url": "example"
            }
          }
        ],
        "updatedAt": 1760000000000,
        "vaultHandle": "example"
      }
    ]
  }
}
```
