# automations.draft_connector

Draft actions from an OpenAPI document already in memory. A docs URL is stored on the draft and is not fetched or promoted.

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
| HTTP | POST /v1/automations/draft_connector |
| MCP tool | automations_draft_connector (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  document: Record<string, unknown>;
  docsUrl?: string;
};
```

## Output

```ts
type Out = {
  draft: {
    key: string;
    level: "draft";
    docsUrl?: string;
    tested: boolean;
    reviewed: boolean;
    auth: "oauth" | "api_key" | "none" | "unknown";
  };
  actions: Array<{
      key: string;
      level: "draft";
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
      path: string;
      fields: Array<{
          name: string;
          in: "path" | "query" | "header" | "body";
          required: boolean;
          schema: Record<string, unknown>;
        }>;
      inputSchema: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      body?: Record<string, unknown>;
      effect: "read" | "outward";
      scopes?: Array<string>;
      servers: Array<string>;
      domains: Array<string>;
      errors?: Array<{
          status: string;
          code: string;
        }>;
      connection?: {
        required: boolean;
      };
      auth: "oauth" | "api_key" | "none" | "unknown";
      tested: boolean;
      reviewed: boolean;
      missing: Array<string>;
    }>;
  request: ({
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS" | "TRACE";
    path: string;
    query: Record<string, Record<string, unknown>>;
    headers: Record<string, Record<string, unknown>>;
    body?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    effect: "read" | "outward";
    servers: Array<string>;
    allowedDomains: Array<string>;
  }) | null;
  refused: Array<{
      path: string;
      reason: string;
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
  "input": {
    "docsUrl": "example",
    "document": {}
  },
  "output": {
    "actions": [
      {
        "auth": "oauth",
        "body": {},
        "connection": {
          "required": true
        },
        "domains": [
          "example"
        ],
        "effect": "read",
        "errors": [
          {
            "code": "example",
            "status": "example"
          }
        ],
        "fields": [
          {
            "in": "path",
            "name": "example",
            "required": true,
            "schema": {}
          }
        ],
        "inputSchema": {},
        "key": "example",
        "level": "draft",
        "method": "GET",
        "missing": [
          "example"
        ],
        "outputSchema": {},
        "path": "example",
        "reviewed": true,
        "scopes": [
          "example"
        ],
        "servers": [
          "example"
        ],
        "tested": true
      }
    ],
    "draft": {
      "auth": "oauth",
      "docsUrl": "example",
      "key": "example",
      "level": "draft",
      "reviewed": true,
      "tested": true
    },
    "refused": [
      {
        "path": "example",
        "reason": "example"
      }
    ],
    "request": {
      "allowedDomains": [
        "example"
      ],
      "body": {},
      "effect": "read",
      "headers": {},
      "method": "GET",
      "outputSchema": {},
      "path": "example",
      "query": {},
      "servers": [
        "example"
      ]
    }
  }
}
```
