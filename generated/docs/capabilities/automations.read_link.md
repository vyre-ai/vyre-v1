# automations.read_link

Open a web page from the server and read it as plain text, with its links. Use it for any link the person gave or a page you read links to. A link you put together yourself waits for the person, because its address can carry data. GET only, no key, public hosts only

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | send when links.is_composed(input.url) |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/automations/read_link |
| MCP tool | read_link (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  url: string;
  focus?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
  reason?: string;
  finalUrl?: string;
  kind?: "openapi" | "html" | "text";
  text?: string;
  links?: Array<{
      text: string;
      url: string;
    }>;
  truncated?: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_approval
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "focus": "example",
    "url": "example"
  },
  "output": {
    "finalUrl": "example",
    "kind": "openapi",
    "links": [
      {
        "text": "example",
        "url": "example"
      }
    ],
    "ok": true,
    "reason": "example",
    "text": "example",
    "truncated": true
  }
}
```
