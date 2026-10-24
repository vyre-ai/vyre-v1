# connections.list

List connections; mine, the Space ones or all the caller may see

| | |
|---|---|
| Module | connectors |
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
| HTTP | POST /v1/connections/list |
| MCP tool | connections_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connector?: string;
  whose?: "mine" | "space" | "all";
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  connections: Array<{
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
    }>;
  next?: string;
  total?: number;
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
    "connector": "hubspot",
    "cursor": "example",
    "limit": 1,
    "whose": "mine"
  },
  "output": {
    "connections": [
      {
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
    ],
    "next": "example",
    "total": 1
  }
}
```
