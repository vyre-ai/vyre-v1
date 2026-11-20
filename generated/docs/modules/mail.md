# Mail (mail)

Lane L5. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (60)

- [mail.address.add](../capabilities/mail.address.add.md): Make an address on a Space domain. With an inbox it is an alias that delivers there; without one a shared inbox is made for it. Who may send as it is a share on the inbox (access.share)
- [mail.address.list](../capabilities/mail.address.list.md): Every address on the Space's domains: inbox addresses and aliases, with the inbox each lands in
- [mail.address.move](../capabilities/mail.address.move.md): Point an address that exists at another inbox. Names the inbox it goes to now and the one it will go to; the person must be able to use the new inbox
- [mail.attachment.save](../capabilities/mail.attachment.save.md): Save an attachment into Files
- [mail.auto_connect_members](../capabilities/mail.auto_connect_members.md): Create Pending mail connections for every mapped member when delegation is set and auto-connect is on (one notice each)
- [mail.configure](../capabilities/mail.configure.md): Email setup, templates and inbox health: action status|test|smtp_*|address_*|monitor|template_*|doc_template_*
- [mail.connect](../capabilities/mail.connect.md): Connect the caller's own Gmail, Outlook or IMAP mailbox
- [mail.delivery.retry](../capabilities/mail.delivery.retry.md): Vyre-only: resend a soft-bounced message to that address
- [mail.delivery.trail](../capabilities/mail.delivery.trail.md): Delivery trail of a sent message: events, retries, blocked addresses
- [mail.delivery_state](../capabilities/mail.delivery_state.md): A sent message's delivery trail: events, retries, blocked addresses
- [mail.domain.add](../capabilities/mail.domain.add.md): Add a sending domain (resend, mailgun, smtp); returns the DNS records to publish
- [mail.domain.check](../capabilities/mail.domain.check.md): Re-check SPF, DKIM and DMARC for a domain (mailauth) and ask the provider to verify
- [mail.domain.get](../capabilities/mail.domain.get.md): Read one sending domain with the DNS records to publish
- [mail.domain.list](../capabilities/mail.domain.list.md): List sending domains with SPF, DKIM and DMARC state
- [mail.domain.remove](../capabilities/mail.domain.remove.md): Remove a sending domain
- [mail.domain.set_default](../capabilities/mail.domain.set_default.md): Make a verified domain the default sender for Space sending
- [mail.draft](../capabilities/mail.draft.md): Create or update a draft (an agent's waits for a person)
- [mail.drafts.discard](../capabilities/mail.drafts.discard.md): Discard a draft
- [mail.drafts.list](../capabilities/mail.drafts.list.md): List drafts for a mailbox or contact
- [mail.health](../capabilities/mail.health.md): Mail sync health: age of the last successful sync per mailbox (worst state wins)
- [mail.inbox.monitor](../capabilities/mail.inbox.monitor.md): Inbox health: how fed, last received, what failed and the fix; unrouted addresses
- [mail.ingest](../capabilities/mail.ingest.md): Land one inbound or synced message: dedupe on provider id, one record across inboxes, link to a contact (sure matches link, unsure go to Needs you)
- [mail.mailbox.create](../capabilities/mail.mailbox.create.md): Create a shared, agent or service mailbox (hello@, support@, an agent address)
- [mail.mailbox.disconnect](../capabilities/mail.mailbox.disconnect.md): Remove a mailbox connection (mail already filed to records stays)
- [mail.mailbox.get](../capabilities/mail.mailbox.get.md): Read one mailbox with its sync state
- [mail.mailbox.list](../capabilities/mail.mailbox.list.md): List mailboxes the caller can see (own, shared with the Space, agent and service mailboxes)
- [mail.mailbox.pause](../capabilities/mail.mailbox.pause.md): Pause a mailbox connection; filing and sync stop
- [mail.mailbox.resume](../capabilities/mail.mailbox.resume.md): Resume a paused mailbox connection
- [mail.mailbox.set_privacy](../capabilities/mail.mailbox.set_privacy.md): Mark a mailbox private, shared with the Space or shared with chosen people
- [mail.mailbox.set_sync_state](../capabilities/mail.mailbox.set_sync_state.md): A connection reports its sign-in lost (error) or working again (syncing)
- [mail.mailbox.update](../capabilities/mail.mailbox.update.md): Rename a mailbox or change its agent
- [mail.member_pause](../capabilities/mail.member_pause.md): The connector stops a member's delegated mailbox, or starts it again; what is already in Vyre stays theirs
- [mail.message.erase](../capabilities/mail.message.erase.md): Erase one mail message for good (governance erase)
- [mail.message.get](../capabilities/mail.message.get.md): Read one message with attachments, provider id, DNS check state and trace id
- [mail.message.list](../capabilities/mail.message.list.md): List messages of a mailbox, thread or contact
- [mail.message.search](../capabilities/mail.message.search.md): Search mail by text, sender, date and mailbox
- [mail.message.set_private](../capabilities/mail.message.set_private.md): Mark a message private so it stays out of the record, or clear the mark (inbox owner only)
- [mail.route.list](../capabilities/mail.route.list.md): List inbound routes (address on a Space domain to a mailbox)
- [mail.route.remove](../capabilities/mail.route.remove.md): Remove an inbound route
- [mail.route.set](../capabilities/mail.route.set.md): Route an address on a Space domain (MX on the Space domain) to a mailbox through /hooks/mail
- [mail.send](../capabilities/mail.send.md): Send an email (suppression, limits and the Gate apply)
- [mail.send_as](../capabilities/mail.send_as.md): Send through a member's own Gmail, Graph or IMAP mailbox (replies go out from the inbox the thread came in on)
- [mail.send_preview](../capabilities/mail.send_preview.md): Dry run of a send: who would be reached and who is suppressed, without sending
- [mail.setup.status](../capabilities/mail.setup.status.md): The Space's email setup in one read: how it sends, what is missing and the next step
- [mail.setup.test_send](../capabilities/mail.setup.test_send.md): Send one short test email to an address you type, from an address on the default verified domain. It goes through mail.send, so limits, suppression and the Gate apply
- [mail.smtp.get](../capabilities/mail.smtp.get.md): The Space's mail server (SMTP) and its last test
- [mail.smtp.set](../capabilities/mail.smtp.set.md): Save the Space's SMTP server; password stays in the Vault
- [mail.smtp.verify](../capabilities/mail.smtp.verify.md): Test an SMTP server (sign in only, nothing sent); no input tests the saved one
- [mail.status_update](../capabilities/mail.status_update.md): Apply a provider status (delivered, bounced, complained, opened, clicked, failed); hard bounces and complaints write the suppression list
- [mail.sync_now](../capabilities/mail.sync_now.md): Sync a mailbox now
- [mail.template.for_document.clear](../capabilities/mail.template.for_document.clear.md): Return a document to the Space's template
- [mail.template.for_document.get](../capabilities/mail.template.for_document.get.md): The template a document uses, and whether it has its own
- [mail.template.for_document.set](../capabilities/mail.template.for_document.set.md): Give a document its own email template wording
- [mail.template.get](../capabilities/mail.template.get.md): Read an email template (a document's own wording with documentId)
- [mail.template.list](../capabilities/mail.template.list.md): List email templates
- [mail.template.preview](../capabilities/mail.template.preview.md): Preview a template or draft filled from a record and values; names blank fields
- [mail.template.reset](../capabilities/mail.template.reset.md): Reset a template to the one that ships with Vyre
- [mail.template.save](../capabilities/mail.template.save.md): Save the Space's email template; text may hold {{field}} or {{field|fallback}}
- [mail.thread.get](../capabilities/mail.thread.get.md): Read one email thread whole, oldest first, with your role in it
- [mail.unsubscribe](../capabilities/mail.unsubscribe.md): Inbound: a person pressed the unsubscribe link in an email; writes the Suppression list

## Events (25)

- [inbound_route.removed](../events/inbound_route.removed.md): An inbound route was removed
- [inbound_route.saved](../events/inbound_route.saved.md): An inbound route was set
- [mail.message_erased](../events/mail.message_erased.md): A mail message was erased for good: body, attachments and search entries (ids only)
- [mail.received](../events/mail.received.md): An email arrived in a mailbox (deduped across inboxes)
- [mail_draft.discarded](../events/mail_draft.discarded.md): A draft was discarded
- [mail_draft.saved](../events/mail_draft.saved.md): A draft was created or changed (an agent draft carries a Gate line)
- [mailbox.connected](../events/mailbox.connected.md): A mailbox connection was created (Pending until the first sync); one notice per member
- [mailbox.created](../events/mailbox.created.md): A shared, agent or service mailbox was created
- [mailbox.disconnected](../events/mailbox.disconnected.md): A mailbox connection was removed
- [mailbox.paused](../events/mailbox.paused.md): The owner paused a mailbox; filing stops
- [mailbox.privacy_changed](../events/mailbox.privacy_changed.md): A mailbox moved between private, shared with the Space and shared with chosen people
- [mailbox.resumed](../events/mailbox.resumed.md): The owner resumed a mailbox
- [mailbox.sync_completed](../events/mailbox.sync_completed.md): A mailbox sync finished
- [mailbox.sync_failed](../events/mailbox.sync_failed.md): A mailbox sync failed; the owner sees the next step
- [message.bounced](../events/message.bounced.md): A message bounced or could not be delivered
- [message.clicked](../events/message.clicked.md): A recipient clicked a link in an email
- [message.complained](../events/message.complained.md): The recipient marked a message as spam
- [message.delivered](../events/message.delivered.md): The provider reports delivery
- [message.failed](../events/message.failed.md): A send failed before reaching the provider
- [message.opened](../events/message.opened.md): A recipient opened an email
- [message.sent](../events/message.sent.md): A message left the Space (email or text)
- [message.suppressed](../events/message.suppressed.md): A send was refused for a suppressed address or missing consent
- [sending_domain.added](../events/sending_domain.added.md): A sending domain was added
- [sending_domain.checked](../events/sending_domain.checked.md): SPF, DKIM and DMARC were checked
- [sending_domain.removed](../events/sending_domain.removed.md): A sending domain was removed
