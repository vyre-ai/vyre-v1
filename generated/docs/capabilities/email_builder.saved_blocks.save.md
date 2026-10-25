# email_builder.saved_blocks.save

Save a block for reuse, or change one of mine; only the person who saved it can change it

| | |
|---|---|
| Module | email-builder-api |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/email_builder/saved_blocks/save |
| MCP tool | email_builder_saved_blocks_save (inbox) |
| CLI | none |
| Emits | email_block.saved |

## Input

```ts
type In = {
  blockId?: string;
  name: string;
  block: {
    type: "text" | "heading" | "image" | "button" | "columns" | "divider" | "merge" | "footer" | "html" | "spacer" | "social" | "saved";
    props: Record<string, unknown>;
  };
  shared?: boolean;
};
```

## Output

```ts
type Out = {
  block: {
    blockId: string;
    name: string;
    block: {
      type: "text" | "heading" | "image" | "button" | "columns" | "divider" | "merge" | "footer" | "html" | "spacer" | "social" | "saved";
      props: Record<string, unknown>;
    };
    shared: boolean;
    updatedAt: number;
  };
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
    "block": {
      "props": {},
      "type": "text"
    },
    "blockId": "blk_a1b2c3",
    "name": "example",
    "shared": true
  },
  "output": {
    "block": {
      "block": {
        "props": {},
        "type": "text"
      },
      "blockId": "blk_a1b2c3",
      "name": "example",
      "shared": true,
      "updatedAt": 1760000000000
    }
  }
}
```
