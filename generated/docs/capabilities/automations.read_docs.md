# automations.read_docs

Read one public API docs page as text, with its same-site links; an OpenAPI document as one line per operation. Any public https page, even one you put together (in an Automation started from outside, that waits for the person). GET, no key. focus: just the passages around a word.

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
| HTTP | POST /v1/automations/read_docs |
| MCP tool | automations_read_docs (automations) |
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
