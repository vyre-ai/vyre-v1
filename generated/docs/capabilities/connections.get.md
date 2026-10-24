# connections.get

Read one connection

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connections/get |
| MCP tool | connections_get (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
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
    "connectionId": "con_a1b2c3"
  },
  "output": {
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
