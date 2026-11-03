# network.peers

The computers that hold this Personal Space: each keeps a full copy and syncs with the others through the relay. This computer, whether each is awake, and when it was last seen

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | use |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/network/peers |
| MCP tool | network_peers (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  waiting: number;
  syncedAt?: number;
  computers: Array<{
      peerId: string;
      name: string;
      platform: string;
      kind: "computer" | "server";
      self: boolean;
      online: boolean;
      lastSeenAt?: number;
      addedAt: number;
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
    "computers": [
      {
        "addedAt": 1760000000000,
        "kind": "computer",
        "lastSeenAt": 1760000000000,
        "name": "example",
        "online": true,
        "peerId": "example",
        "platform": "example",
        "self": true
      }
    ],
    "syncedAt": 1760000000000,
    "waiting": 1
  }
}
```
