# access.record_marks

For the rows of one record type: which differ from the type (their own audience or direct grants), and whether the caller was given the type or a row by name

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
| HTTP | POST /v1/access/record_marks |
| MCP tool | access_record_marks (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
};
```

## Output

```ts
type Out = {
  typeShared: boolean;
  audience: "space" | "added" | "me";
  can: {
    manage: boolean;
    edit?: boolean;
    share: boolean;
    export: boolean;
  };
  rows: Array<{
      id: string;
      audience: "space" | "added" | "me";
      direct: number;
      mine: boolean;
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
    "type": "contact"
  },
  "output": {
    "audience": "space",
    "can": {
      "edit": true,
      "export": true,
      "manage": true,
      "share": true
    },
    "rows": [
      {
        "audience": "space",
        "direct": 1,
        "id": "rec_a1b2c3",
        "mine": true
      }
    ],
    "typeShared": true
  }
}
```
