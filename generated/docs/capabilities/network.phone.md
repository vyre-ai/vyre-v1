# network.phone

Your phone address on vyre.run: the name this computer holds, whether it is online, and the link that opens it on a phone

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
| HTTP | POST /v1/network/phone |
| MCP tool | network_phone (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  state: "none" | "claiming" | "claimed" | "releasing" | "failed";
  name?: string;
  nickname?: string;
  url?: string;
  link?: string;
  online: boolean;
  detail?: string;
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
    "detail": "example",
    "link": "example",
    "name": "example",
    "nickname": "example",
    "online": true,
    "state": "none",
    "url": "example"
  }
}
```
