# access.provider_check

Which of these resources may not go to an AI provider, by the same label-against-provider rule a chat turn is held to

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
| HTTP | POST /v1/access/provider_check |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  resources: Array<{
      type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
      id: string;
    }>;
  provider: string;
};
```

## Output

```ts
type Out = {
  blocked: Array<{
      id: string;
      label?: "public" | "internal" | "confidential" | "restricted";
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
    "provider": "openai",
    "resources": [
      {
        "id": "rec_a1b2c3",
        "type": "space"
      }
    ]
  },
  "output": {
    "blocked": [
      {
        "id": "example",
        "label": "public"
      }
    ]
  }
}
```
