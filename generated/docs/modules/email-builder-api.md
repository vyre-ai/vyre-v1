# Email builder (email-builder-api)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (16)

- [email_builder.ask_diff](../capabilities/email_builder.ask_diff.md): Ask Vyre edit: returns a per-change diff the author accepts change by change
- [email_builder.create](../capabilities/email_builder.create.md): Create an email design
- [email_builder.get](../capabilities/email_builder.get.md): Read an email design
- [email_builder.html_set](../capabilities/email_builder.html_set.md): Set full HTML (an agent can write it and place it)
- [email_builder.list](../capabilities/email_builder.list.md): List email designs (campaigns, inbox templates, automation steps share them)
- [email_builder.merge_fields](../capabilities/email_builder.merge_fields.md): Merge fields available for a record type
- [email_builder.render](../capabilities/email_builder.render.md): Render desktop, mobile, dark and plain-text previews, optionally as a record
- [email_builder.restore_version](../capabilities/email_builder.restore_version.md): Restore a version
- [email_builder.save](../capabilities/email_builder.save.md): Autosave a design; each save is a version
- [email_builder.saved_blocks.list](../capabilities/email_builder.saved_blocks.list.md): List saved blocks: mine and the ones shared with the Space, to drop into a design
- [email_builder.saved_blocks.save](../capabilities/email_builder.saved_blocks.save.md): Save a block for reuse, or change one of mine; only the person who saved it can change it
- [email_builder.send_test](../capabilities/email_builder.send_test.md): Send a test email to the author
- [email_builder.snippets.delete](../capabilities/email_builder.snippets.delete.md): Delete a composer snippet
- [email_builder.snippets.list](../capabilities/email_builder.snippets.list.md): List composer snippets: short reusable text for Inbox email and text replies, mine and shared with the Space
- [email_builder.snippets.save](../capabilities/email_builder.snippets.save.md): Create or change a composer snippet
- [email_builder.versions](../capabilities/email_builder.versions.md): List saved versions

## Events (3)

- [email_block.saved](../events/email_block.saved.md): A block was saved for reuse in email designs
- [email_template.saved](../events/email_template.saved.md): An email design was saved as a version
- [email_template.test_sent](../events/email_template.test_sent.md): A test email was sent to the author
