# automations.connector.save

Create or change a connector from a definition: hosts, how the key maps from a Vault field, actions and triggers. It is stored as a draft. A change sends the changed parts back to draft. The definition holds no key: name the Vault item in vaultHandle.

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | automations.personal |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/automations/connector/save |
| MCP tool | automations_connector_save (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  definition: {
    app: string;
    title: string;
    docsUrl?: string;
    domains: Array<string>;
    auth: {
      type: "api_key" | "bearer" | "basic" | "none";
      field?: string;
      userField?: string;
      header?: string;
      prefix?: string;
      query?: string;
    };
    actions?: Array<{
        key: string;
        title: string;
        description?: string;
        method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
        path: string;
        params?: Array<{
            name: string;
            in: "path" | "query" | "header" | "body";
            required?: boolean;
            type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
            description?: string;
          }>;
        output?: string;
        host?: string;
        effect?: "read" | "outward";
        markedSafe?: boolean;
      }>;
    triggers?: Array<{
        key: string;
        title: string;
        kind: "poll" | "webhook";
        action?: string;
        intervalSec?: number;
        items?: string;
        idField?: string;
        order?: "newest_first" | "oldest_first";
        cursor?: {
          mode: "none" | "updated_since" | "after_id" | "next_token";
          param?: string;
          field?: string;
          format?: "iso" | "epoch_s" | "epoch_ms";
          from?: string;
        };
        sample?: unknown;
      }>;
  };
  vaultHandle?: string;
};
```

## Output

```ts
type Out = {
  connector: {
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
  };
};
```

## Errors

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
    "definition": {
      "actions": [
        {
          "description": "example",
          "effect": "read",
          "host": "example",
          "key": "list_customers",
          "markedSafe": true,
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
      "title": "example",
      "triggers": [
        {
          "action": "list_customers",
          "cursor": {
            "field": "example",
            "format": "iso",
            "from": "example",
            "mode": "none",
            "param": "example"
          },
          "idField": "example",
          "intervalSec": 60,
          "items": "example",
          "key": "list_customers",
          "kind": "poll",
          "order": "newest_first",
          "sample": {},
          "title": "example"
        }
      ]
    },
    "vaultHandle": "example"
  },
  "output": {
    "connector": {
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
  }
}
```
