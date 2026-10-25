# email_builder.saved_blocks.list

List saved blocks: mine and the ones shared with the Space, to drop into a design

| | |
|---|---|
| Module | email-builder-api |
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
| HTTP | POST /v1/email_builder/saved_blocks/list |
| MCP tool | email_builder_saved_blocks_list (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  blocks: Array<{
      blockId: string;
      name: string;
      block: {
        type: "text" | "heading" | "image" | "button" | "columns" | "divider" | "merge" | "footer" | "html" | "spacer" | "social" | "saved";
        props: Record<string, unknown>;
      };
      shared: boolean;
      updatedAt: number;
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
    "blocks": [
      {
        "block": {
          "props": {},
          "type": "text"
        },
        "blockId": "blk_a1b2c3",
        "name": "example",
        "shared": true,
        "updatedAt": 1760000000000
      }
    ]
  }
}
```
