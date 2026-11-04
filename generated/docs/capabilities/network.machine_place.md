# network.machine_place

Which machine a turn goes to, given the places to try in order: the first with room, skipping a busy one, and why it moved (the Ran on line)

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
| HTTP | POST /v1/network/machine_place |
| MCP tool | network_machine_place (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  order: Array<string>;
};
```

## Output

```ts
type Out = {
  serverId: string | null;
  name: string | null;
  skipped: Array<{
      serverId: string;
      name: string;
      why: string;
    }>;
  moved: boolean;
  line: string | null;
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
    "order": [
      "srv_local"
    ]
  },
  "output": {
    "line": "example",
    "moved": true,
    "name": "example",
    "serverId": "example",
    "skipped": [
      {
        "name": "example",
        "serverId": "example",
        "why": "example"
      }
    ]
  }
}
```
