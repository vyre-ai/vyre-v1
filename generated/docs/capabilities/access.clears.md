# access.clears

Whether a principal's clearance reaches what a resource is labelled (its own label and every folder above it). Asked before a key is stored or shared for an agent, because a thing labelled above an agent's clearance is refused to it whatever it is granted. It answers yes or no and shows nothing else

| | |
|---|---|
| Module | access |
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
| HTTP | POST /v1/access/clears |
| MCP tool | access_clears (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  principal: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar" | "skill";
    id: string;
  };
};
```

## Output

```ts
type Out = {
  clears: boolean;
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
    "principal": {
      "id": "usr_a1b2c3",
      "kind": "person"
    },
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    }
  },
  "output": {
    "clears": true
  }
}
```
