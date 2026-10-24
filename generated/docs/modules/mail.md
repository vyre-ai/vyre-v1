# Mail (mail)

Lane L5. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (34)

- [mail.attachment.save](../capabilities/mail.attachment.save.md): Save an attachment into Files
- [mail.auto_connect_members](../capabilities/mail.auto_connect_members.md): Create Pending mail connections for every mapped member when delegation is set and auto-connect is on (one notice each)
- [mail.connect](../capabilities/mail.connect.md): Connect the caller's own mailbox: Gmail, Outlook or IMAP (member impersonation for Google and Graph, app password handle for IMAP)
- [mail.domain.add](../capabilities/mail.domain.add.md): Add a sending domain at Resend or Mailgun and return the DNS records to publish
- [mail.domain.check](../capabilities/mail.domain.check.md): Re-check SPF, DKIM and DMARC for a domain (mailauth) and ask the provider to verify
- [mail.domain.get](../capabilities/mail.domain.get.md): Read one sending domain with the DNS records to publish
- [mail.domain.list](../capabilities/mail.domain.list.md): List sending domains with SPF, DKIM and DMARC state
- [mail.domain.remove](../capabilities/mail.domain.remove.md): Remove a sending domain
- [mail.domain.set_default](../capabilities/mail.domain.set_default.md): Make a verified domain the default sender for Space sending
- [mail.draft](../capabilities/mail.draft.md): Create or update a draft (an agent draft waits for Send, Edit or Discard with a Gate line)
- [mail.drafts.discard](../capabilities/mail.drafts.discard.md): Discard a draft
- [mail.drafts.list](../capabilities/mail.drafts.list.md): List drafts for a mailbox or contact
- [mail.health](../capabilities/mail.health.md): Mail sync health: age of the last successful sync per mailbox (worst state wins)
- [mail.ingest](../capabilities/mail.ingest.md): Land one inbound or synced message: dedupe on provider id, one record across inboxes, link to a contact (sure matches link, unsure go to Needs you)
- [mail.mailbox.create](../capabilities/mail.mailbox.create.md): Create a shared, agent or service mailbox (hello@, support@, an agent address)
- [mail.mailbox.disconnect](../capabilities/mail.mailbox.disconnect.md): Remove a mailbox connection (mail already filed to records stays)
- [mail.mailbox.get](../capabilities/mail.mailbox.get.md): Read one mailbox with its sync state
- [mail.mailbox.list](../capabilities/mail.mailbox.list.md): List mailboxes the caller can see (own, shared with the Space, agent and service mailboxes)
- [mail.mailbox.pause](../capabilities/mail.mailbox.pause.md): Pause a mailbox connection; filing and sync stop
- [mail.mailbox.resume](../capabilities/mail.mailbox.resume.md): Resume a paused mailbox connection
- [mail.mailbox.set_privacy](../capabilities/mail.mailbox.set_privacy.md): Mark a mailbox private, shared with the Space or shared with chosen people
- [mail.mailbox.update](../capabilities/mail.mailbox.update.md): Rename a mailbox or change its agent
- [mail.message.get](../capabilities/mail.message.get.md): Read one message with attachments, provider id, DNS check state and trace id
- [mail.message.list](../capabilities/mail.message.list.md): List messages of a mailbox, thread or contact
- [mail.message.search](../capabilities/mail.message.search.md): Search mail by text, sender, date and mailbox
- [mail.message.set_private](../capabilities/mail.message.set_private.md): Mark a message private so it stays out of the record, or clear the mark (inbox owner only)
- [mail.route.list](../capabilities/mail.route.list.md): List inbound routes (address on a Space domain to a mailbox)
- [mail.route.remove](../capabilities/mail.route.remove.md): Remove an inbound route
- [mail.route.set](../capabilities/mail.route.set.md): Route an address on a Space domain (MX on the Space domain) to a mailbox through /hooks/mail
- [mail.send](../capabilities/mail.send.md): Send an email through the single send API: caps per sender, send windows, throttling, suppression, consent, trace id header, agent footer line
- [mail.send_as](../capabilities/mail.send_as.md): Send through a member's own Gmail, Graph or IMAP mailbox (replies go out from the inbox the thread came in on)
- [mail.send_preview](../capabilities/mail.send_preview.md): Dry run of a send: suppressed recipients, window, caps and throttle, without sending (campaign launch preview uses it)
- [mail.status_update](../capabilities/mail.status_update.md): Apply a provider status (delivered, bounced, complained, opened, clicked, failed); hard bounces and complaints write the suppression list
- [mail.sync_now](../capabilities/mail.sync_now.md): Sync a mailbox now

## Events (24)

- [inbound_route.removed](../events/inbound_route.removed.md): An inbound route was removed
- [inbound_route.saved](../events/inbound_route.saved.md): An inbound route was set
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
