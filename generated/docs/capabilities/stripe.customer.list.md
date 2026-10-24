# stripe.customer.list

List or search customers

| | |
|---|---|
| Module | stripe |
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
| HTTP | POST /v1/stripe/customer/list |
| MCP tool | stripe_customer_list (sites, deferred) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  email?: string;
  pageToken?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  customers: Array<{
      id: string;
      email?: string;
      name?: string;
      created?: number;
      metadata?: Record<string, string>;
    }>;
  nextPageToken?: string;
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
    "cursor": "example",
    "email": "maya@example.com",
    "limit": 1,
    "pageToken": "example"
  },
  "output": {
    "customers": [
      {
        "created": 1760000000000,
        "email": "maya@example.com",
        "id": "cus_123",
        "metadata": {},
        "name": "example"
      }
    ],
    "nextPageToken": "example"
  }
}
```
