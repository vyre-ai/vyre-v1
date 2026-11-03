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
  preview?: boolean;
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
  meta?: {
    title?: string;
    image?: string;
    siteName?: string;
    description?: string;
    icon?: string;
  };
  preview?: {
    contentType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
    data: string;
    from: "image" | "icon";
  };
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
    "preview": true,
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
    "meta": {
      "description": "example",
      "icon": "example",
      "image": "example",
      "siteName": "example",
      "title": "example"
    },
    "ok": true,
    "preview": {
      "contentType": "image/png",
      "data": "example",
      "from": "image"
    },
    "reason": "example",
    "text": "example",
    "truncated": true
  }
}
```
