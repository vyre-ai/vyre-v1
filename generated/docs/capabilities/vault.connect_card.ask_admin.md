# vault.connect_card.ask_admin

Ask an admin to connect the service when this person may not

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
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/connect_card/ask_admin |
| MCP tool | vault_connect_card_ask_admin (vault) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  requestId: string;
  admin?: string;
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
    notice?: string;
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
    "admin": "usr_a1b2c3",
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
      "notice": "example",
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
