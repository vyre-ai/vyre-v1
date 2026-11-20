# mail.template.list

List email templates

| | |
|---|---|
| Module | mail |
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
| HTTP | POST /v1/mail/template/list |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  templates: Array<{
      key: string;
      title: string;
      subject: string;
      source: "space" | "builtin";
      customised: boolean;
      updatedAt?: number;
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
    "templates": [
      {
        "customised": true,
        "key": "example",
        "source": "space",
        "subject": "example",
        "title": "example",
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
