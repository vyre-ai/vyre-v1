# access.deciders

The people who hold Manage on a resource and so may decide a request about it. Used to route a request to a person even when the caller, an agent, cannot see the resource itself; it names people and shows nothing else

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
| HTTP | POST /v1/access/deciders |
| MCP tool | access_deciders (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  resource: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
};
```

## Output

```ts
type Out = {
  people: Array<string>;
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
    "resource": {
      "id": "rec_a1b2c3",
      "type": "space"
    }
  },
  "output": {
    "people": [
      "usr_a1b2c3"
    ]
  }
}
```
