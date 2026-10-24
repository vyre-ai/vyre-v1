# files.external_links

List the outside links of a file

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | manage |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/external_links |
| MCP tool | files_external_links (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  links: Array<{
      linkId: string;
      createdBy: string;
      createdAt: number;
      expiresAt?: number;
      opens: number;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "links": [
      {
        "createdAt": 1760000000000,
        "createdBy": "example",
        "expiresAt": 1760000000000,
        "linkId": "lnk_a1b2c3",
        "opens": 1
      }
    ]
  }
}
```
