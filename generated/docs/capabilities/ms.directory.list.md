# ms.directory.list

The people in the Microsoft 365 directory (admin only), with the Space member each is matched to, for choosing who to bring in

| | |
|---|---|
| Module | microsoft |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/ms/directory/list |
| MCP tool | ms_directory_list (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  skipToken?: string;
  query?: string;
};
```

## Output

```ts
type Out = {
  people: Array<{
      email: string;
      name?: string;
      suspended: boolean;
      userId?: string;
    }>;
  nextSkipToken?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.auth_failed
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "query": "example",
    "skipToken": "example"
  },
  "output": {
    "nextSkipToken": "example",
    "people": [
      {
        "email": "maya@example.com",
        "name": "example",
        "suspended": true,
        "userId": "usr_a1b2c3"
      }
    ]
  }
}
```
