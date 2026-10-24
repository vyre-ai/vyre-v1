# stars.list

My starred things, newest first

| | |
|---|---|
| Module | spaces |
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
| HTTP | POST /v1/stars/list |
| MCP tool | stars_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type?: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
};
```

## Output

```ts
type Out = {
  stars: Array<{
      resource: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain";
        id: string;
      };
      title: string;
      at: number;
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
  "input": {
    "type": "space"
  },
  "output": {
    "stars": [
      {
        "at": 1760000000000,
        "resource": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "title": "example"
      }
    ]
  }
}
```
