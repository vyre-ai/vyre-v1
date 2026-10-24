# home.write_digest

Store a digest the assistant wrote for a person (scheduled)

| | |
|---|---|
| Module | home |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/home/write_digest |
| MCP tool | none |
| CLI | none |
| Emits | digest.written |

## Input

```ts
type In = {
  person: string;
  periodStart: number;
  periodEnd: number;
  headline: Array<string>;
  items: Array<{
      kind: "decision" | "finished" | "record_change" | "routine" | "waiting";
      title: string;
      line: string;
      subject?: {
        type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "campaign" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
        id: string;
      };
      at?: number;
      undo?: {
        cap: string;
        input: unknown;
      };
    }>;
  builtBy: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  digestId: string;
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
    "builtBy": "example",
    "headline": [
      "example"
    ],
    "idempotencyKey": "idem_1",
    "items": [
      {
        "at": 1760000000000,
        "kind": "decision",
        "line": "example",
        "subject": {
          "id": "rec_a1b2c3",
          "type": "space"
        },
        "title": "example",
        "undo": {
          "cap": "runs.undo",
          "input": {}
        }
      }
    ],
    "periodEnd": 1760000000000,
    "periodStart": 1760000000000,
    "person": "example"
  },
  "output": {
    "digestId": "dgs_a1b2c3"
  }
}
```
