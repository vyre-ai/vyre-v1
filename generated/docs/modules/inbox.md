# Inbox (inbox)

Lane L5. Kind module. Version 0.1.0.

Requires: calendar, mail, telephony.

## Capabilities (16)

- [inbox.counts](../capabilities/inbox.counts.md): Unread counts for the sidebar: per inbox, per number and the Needs a match total
- [inbox.follow_set](../capabilities/inbox.follow_set.md): Follow a contact or set Alert me on replies (the follow itself is stored with stars and follows)
- [inbox.following](../capabilities/inbox.following.md): Contacts that reach your Inbox and why: owner, project, follow, campaign or shared inbox
- [inbox.link_message](../capabilities/inbox.link_message.md): Shared linking step for a stored message, text or call: sure matches link, unsure go to Needs you, unowned replies route to the campaign owner then the shared inbox
- [inbox.list_by_contact](../capabilities/inbox.list_by_contact.md): Inbox default view: one row per person, newest message across email, text and calls
- [inbox.list_by_thread](../capabilities/inbox.list_by_thread.md): Inbox thread view: one row per email thread or text thread
- [inbox.mark_read](../capabilities/inbox.mark_read.md): Mark a conversation read or unread
- [inbox.match](../capabilities/inbox.match.md): Match a sender to a contact or company record (Undo stays available)
- [inbox.match_new](../capabilities/inbox.match_new.md): Create a contact or company from an unmatched sender and match it
- [inbox.match_suggestions](../capabilities/inbox.match_suggestions.md): Suggested records for one sender
- [inbox.needs_match](../capabilities/inbox.needs_match.md): The Needs a match filter: unsure senders with suggested records
- [inbox.recipients_search](../capabilities/inbox.recipients_search.md): Ranked recipient search across contacts, members, inboxes and groups (the shared Recipients field)
- [inbox.send_options](../capabilities/inbox.send_options.md): Channels and sending inboxes for a contact; the default is the inbox the thread came in on
- [inbox.thread](../capabilities/inbox.thread.md): The whole history of one contact: emails, texts, calls, meetings, campaign lines and record chips
- [inbox.unmatch](../capabilities/inbox.unmatch.md): Undo a match; the sender goes back to Unmatched
- [inbox.unmatched](../capabilities/inbox.unmatched.md): The Unmatched list: senders with no record that did not raise Needs a match

## Events (7)

- [conversation.campaign_reply](../events/conversation.campaign_reply.md): A contact on a campaign replied; it lands in the owner Inbox marked with the campaign
- [conversation.created](../events/conversation.created.md): A conversation row was opened for a new address or contact
- [conversation.follow_changed](../events/conversation.follow_changed.md): A person followed or unfollowed a contact conversation
- [conversation.matched](../events/conversation.matched.md): A sender was linked to a contact or company record
- [conversation.needs_match](../events/conversation.needs_match.md): An unsure sender needs a person to pick the record
- [conversation.reply_received](../events/conversation.reply_received.md): A followed contact replied (Alert me on replies raises it to Interrupt in working hours)
- [conversation.unmatched](../events/conversation.unmatched.md): A match was undone
