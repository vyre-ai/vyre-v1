# home.checklist

The first-run checklist: five items, hidden once all are done or dismissed

| | |
|---|---|
| Module | home |
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
| HTTP | POST /v1/home/checklist |
| MCP tool | home_checklist (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  visible: boolean;
  items: Array<{
      key: "photo_and_title" | "connect_mailbox_and_calendar" | "meet_assistant" | "open_first_project" | "import";
      title: string;
      done: boolean;
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
  "input": {},
  "output": {
    "items": [
      {
        "done": true,
        "key": "photo_and_title",
        "title": "example"
      }
    ],
    "visible": true
  }
}
```
