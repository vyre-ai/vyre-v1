# network.phone_claim

Claim a name like alex.vyre.run once, so a phone reaches this computer there while it is on and online. The relay only passes sealed bytes

| | |
|---|---|
| Module | network |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/network/phone_claim |
| MCP tool | network_phone_claim (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  name: string;
  nickname?: string;
};
```

## Output

```ts
type Out = {
  state: "claiming";
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
    "name": "alex",
    "nickname": "home-laptop"
  },
  "output": {
    "state": "claiming"
  }
}
```
