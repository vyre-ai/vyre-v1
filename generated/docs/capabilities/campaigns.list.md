# campaigns.list

List campaigns by section and folder

| | |
|---|---|
| Module | campaigns |
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
| HTTP | POST /v1/campaigns/list |
| MCP tool | campaigns_list (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folderId?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  campaigns: Array<{
      campaignId: string;
      name: string;
      kind: "one_time" | "sequence" | "triggered";
      state: "draft" | "scheduled" | "running" | "paused" | "stopped" | "completed";
      owner: string;
      audienceCount: number;
      sent: number;
      replies: number;
    }>;
  next?: string;
  total?: number;
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
    "folderId": "fld_a1b2c3",
    "limit": 1,
    "section": "personal"
  },
  "output": {
    "campaigns": [
      {
        "audienceCount": 1,
        "campaignId": "cmp_a1b2c3",
        "kind": "one_time",
        "name": "example",
        "owner": "usr_a1b2c3",
        "replies": 1,
        "sent": 1,
        "state": "draft"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
