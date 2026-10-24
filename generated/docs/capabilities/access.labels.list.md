# access.labels.list

The four sensitivity labels with rank, provider rule and laptop-sync rule

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
| HTTP | POST /v1/access/labels/list |
| MCP tool | access_labels_list (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  labels: Array<{
      label: "public" | "internal" | "confidential" | "restricted";
      rank: number;
      providers: "any" | "approved" | "none";
      syncToLaptop: boolean;
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
    "labels": [
      {
        "label": "public",
        "providers": "any",
        "rank": 1,
        "syncToLaptop": true
      }
    ]
  }
}
```
