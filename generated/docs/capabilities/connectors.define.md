# connectors.define

Say what a draft connector is in one call: the hosts it may reach, how it signs in (a secret slot the connection fills from a Vault handle), and its actions. A GET is a read; anything else must be marked write. Replaces the draft; nothing goes live until publish.

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
| MCP tool | connectors_define (engineer) |
| CLI | none |
| Emits | connector.built |

## Input

```ts
type In = {
  key: string;
  title?: string;
  domains: Array<string>;
  auth: {
    type: "none" | "api_key" | "bearer";
    secret?: string;
    header?: string;
    prefix?: string;
  };
  secrets?: Array<{
      name: string;
      description: string;
    }>;
  actions: Array<{
      name: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      url: string;
      headers?: Record<string, string>;
      query?: Record<string, string>;
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
        "headers": {},
        "method": "GET",
        "name": "example",
        "output": "example",
        "query": {},
        "url": "example",
        "write": true
      }
    ],
    "auth": {
      "header": "example",
      "prefix": "example",
      "secret": "example",
      "type": "none"
    },
    "domains": [
      "example"
    ],
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
