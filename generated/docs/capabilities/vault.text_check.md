# vault.text_check

Which of my own Mine items have a value in this text: their handles, never a value

| | |
|---|---|
| Module | vault |
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
| HTTP | POST /v1/vault/text_check |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  text: string;
};
```

## Output

```ts
type Out = {
  handles: Array<string>;
  checked: boolean;
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
    "text": "example"
  },
  "output": {
    "checked": true,
    "handles": [
      "example"
    ]
  }
}
```
