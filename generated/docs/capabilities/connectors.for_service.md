# connectors.for_service

Find the connector for a service named in words (Fathom, Slack), the fields it needs, and whether the caller already has it connected

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/for_service |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  service: string;
};
```

## Output

```ts
type Out = {
  found: boolean;
  connector?: {
    key: string;
    title: string;
    scope: "person" | "space";
    mode: "api" | "mcp" | "dwd" | "oauth_app" | "webhook_only";
    fields: Array<{
        name: string;
        label: string;
        optional: boolean;
      }>;
    site?: string;
    builtin: boolean;
    host?: string;
    checks: boolean;
  };
  connection?: {
    connectionId: string;
    owner: "mine" | "space";
    state: "pending" | "active" | "paused" | "needs_reconnect" | "failing";
  };
  near?: Array<string>;
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
    "service": "Fathom"
  },
  "output": {
    "connection": {
      "connectionId": "con_a1b2c3",
      "owner": "mine",
      "state": "pending"
    },
    "connector": {
      "builtin": true,
      "checks": true,
      "fields": [
        {
          "label": "example",
          "name": "example",
          "optional": true
        }
      ],
      "host": "example",
      "key": "hubspot",
      "mode": "api",
      "scope": "person",
      "site": "example",
      "title": "example"
    },
    "found": true,
    "near": [
      "example"
    ]
  }
}
```
