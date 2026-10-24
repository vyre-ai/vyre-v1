# connections.create

Plug an account into a connector; secrets are named Vault items, never values

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | connectors.manage |
| Grant level | edit |
| Risk | medium |
| Resource | connector (create under /connector) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connections/create |
| MCP tool | connections_create (engineer) |
| CLI | none |
| Emits | connection.created |

## Input

```ts
type In = {
  connector: string;
  title: string;
  ownerKind: "person" | "space";
  secrets?: Record<string, string>;
  scopes?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  connection: {
    connectionId: string;
    connector: string;
    title: string;
    owner: {
      kind: "person" | "space";
      id: string;
    };
    state: "pending" | "active" | "paused" | "needs_reconnect" | "failing";
    pausedBy?: string;
    scopes: Array<string>;
    lastSyncAt?: number;
    createdAt: number;
  };
  authUrl?: string;
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
    "connector": "hubspot",
    "idempotencyKey": "idem_1",
    "ownerKind": "person",
    "scopes": [
      "example"
    ],
    "secrets": {},
    "title": "example"
  },
  "output": {
    "authUrl": "example",
    "connection": {
      "connectionId": "con_a1b2c3",
      "connector": "hubspot",
      "createdAt": 1760000000000,
      "lastSyncAt": 1760000000000,
      "owner": {
        "id": "example",
        "kind": "person"
      },
      "pausedBy": "example",
      "scopes": [
        "example"
      ],
      "state": "pending",
      "title": "example"
    }
  }
}
```
