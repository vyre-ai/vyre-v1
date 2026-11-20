# connectors.define

Define a draft connector in one call: hosts, sign-in (key, bearer, basic, or a header template) and actions (paginate, health). A GET is a read, else write. Templates: {input.x}, {secret.X}, {input.x?}. Replaces the draft.

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connectors/define |
| MCP tool | connectors_define (automations) |
| CLI | none |
| Emits | connector.built |

## Input

```ts
type In = {
  key: string;
  title?: string;
  domains: Array<string>;
  auth: {
    type: "none" | "api_key" | "bearer" | "basic" | "header";
    secret?: string;
    header?: string;
    prefix?: string;
    user?: string;
    password?: string;
    template?: string;
  };
  secrets?: Array<{
      name: string;
      description: string;
    }>;
  health?: string;
  actions: Array<{
      name: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      url: string;
      headers?: Record<string, string>;
      query?: Record<string, string>;
      body?: unknown;
      form?: Record<string, string>;
      basic?: {
        user: string;
        pass?: string;
      };
      paginate?: {
        kind: "page" | "cursor" | "offset" | "link";
        param?: string;
        next?: string;
        items: string;
        id: string;
        size?: number;
        start?: number;
      };
      output?: string;
      write?: boolean;
    }>;
};
```

## Output

```ts
type Out = {
  key: string;
  draftId: string;
  actions: Array<string>;
  domains: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "actions": [
      {
        "basic": {
          "pass": "example",
          "user": "example"
        },
        "body": {},
        "form": {},
        "headers": {},
        "method": "GET",
        "name": "example",
        "output": "example",
        "paginate": {
          "id": "example",
          "items": "example",
          "kind": "page",
          "next": "example",
          "param": "example",
          "size": 1,
          "start": 1
        },
        "query": {},
        "url": "example",
        "write": true
      }
    ],
    "auth": {
      "header": "example",
      "password": "example",
      "prefix": "example",
      "secret": "example",
      "template": "example",
      "type": "none",
      "user": "example"
    },
    "domains": [
      "example"
    ],
    "health": "example",
    "key": "hubspot",
    "secrets": [
      {
        "description": "example",
        "name": "example"
      }
    ],
    "title": "example"
  },
  "output": {
    "actions": [
      "example"
    ],
    "domains": [
      "example"
    ],
    "draftId": "cdr_a1b2c3",
    "key": "hubspot"
  }
}
```
