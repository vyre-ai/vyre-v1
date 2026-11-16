# connections.approve_hosts

The person who owns a connection allows the hosts its connector now calls (it gained one since they approved): the key may then go there. A person's press on the connection; never an agent's

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
| HTTP | POST /v1/connections/approve_hosts |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  hosts: Array<string>;
};
```

## Output

```ts
type Out = {
  hosts: Array<string>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "connectionId": "con_a1b2c3",
    "hosts": [
      "example"
    ]
  },
  "output": {
    "hosts": [
      "example"
    ]
  }
}
```
