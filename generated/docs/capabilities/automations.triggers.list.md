# automations.triggers.list

The trigger palette: every trigger with its payload schema, sample and whether a Personal Space can use it

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/triggers/list |
| MCP tool | automations_triggers_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  triggers: Array<{
      key: string;
      title: string;
      payload: unknown;
      sample: unknown;
      personalOk: boolean;
      allowSelfTrigger: boolean;
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
    "triggers": [
      {
        "allowSelfTrigger": true,
        "key": "example",
        "payload": {},
        "personalOk": true,
        "sample": {},
        "title": "example"
      }
    ]
  }
}
```
