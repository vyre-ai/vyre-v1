# connections.set_secret

Fill one empty secret slot of a connection from a Vault handle (a name such as #Resend_Webhook.secret, never a value). The last empty slot turns a pending API connection active.

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/connections/set_secret |
| MCP tool | connections_set_secret (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  slot: string;
  handle: string;
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
    handles: Array<string>;
    filled: Array<string>;
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
    "connectionId": "con_a1b2c3",
    "handle": "#Dana_Lawmatics",
    "slot": "example"
  },
  "output": {
    "connection": {
      "connectionId": "con_a1b2c3",
      "connector": "hubspot",
      "createdAt": 1760000000000,
      "filled": [
        "example"
      ],
      "handles": [
        "#Dana_Lawmatics"
      ],
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
