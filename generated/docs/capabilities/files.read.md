# files.read

Read the content of a file or one of its versions as text, base64 or a short-lived download address

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/read |
| MCP tool | files_read (files) |
| CLI | vyre files cat |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  versionId?: string;
  as?: "text" | "base64" | "url";
  offset?: number;
  length?: number;
};
```

## Output

```ts
type Out = {
  text?: string;
  base64?: string;
  url?: string;
  mime: string;
  size: number;
  version: number;
  truncated: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.too_large

## Example

```json
{
  "name": "example",
  "input": {
    "as": "text",
    "fileId": "fil_a1b2c3",
    "length": 1,
    "offset": 1,
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "base64": "example",
    "mime": "example",
    "size": 1,
    "text": "example",
    "truncated": true,
    "url": "example",
    "version": 1
  }
}
```
