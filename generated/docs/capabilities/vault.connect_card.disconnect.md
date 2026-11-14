# vault.connect_card.disconnect

Disconnect the service; the key stays in the Vault

| | |
|---|---|
| Module | vault-requests |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/connect_card/disconnect |
| MCP tool | vault_connect_card_disconnect (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
};
```

## Output

```ts
type Out = {
  card: {
    requestId: string;
    state: "ask" | "have" | "admin" | "asked" | "connected" | "wrong" | "offline" | "later" | "gone";
    service: {
      key: string;
      title: string;
      site?: string;
    };
    fields: Array<{
        name: string;
        label: string;
        optional: boolean;
      }>;
    agentId?: string;
    mayFill: boolean;
    admin?: {
      id: string;
      askedAt?: number;
    };
    have?: {
      itemId: string;
      name: string;
      keptIn: string;
    };
    keptIn?: string;
    tested?: string;
    checks: boolean;
    checksWith?: string;
    connectedBy?: string;
    connectionId?: string;
    usedBy: Array<{
        kind: "person" | "agent" | "actor" | "service";
        id: string;
      }>;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "requestId": "vrq_a1b2c3"
  },
  "output": {
    "card": {
      "admin": {
        "askedAt": 1760000000000,
        "id": "usr_a1b2c3"
      },
      "agentId": "agt_a1b2c3",
      "checks": true,
      "checksWith": "example",
      "connectedBy": "usr_a1b2c3",
      "connectionId": "con_a1b2c3",
      "fields": [
        {
          "label": "example",
          "name": "example",
          "optional": true
        }
      ],
      "have": {
        "itemId": "vit_a1b2c3",
        "keptIn": "example",
        "name": "example"
      },
      "keptIn": "example",
      "mayFill": true,
      "requestId": "vrq_a1b2c3",
      "service": {
        "key": "hubspot",
        "site": "example",
        "title": "example"
      },
      "state": "ask",
      "tested": "example",
      "usedBy": [
        {
          "id": "usr_a1b2c3",
          "kind": "person"
        }
      ]
    }
  }
}
```
