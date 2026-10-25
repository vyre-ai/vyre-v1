# Forms and bookings (forms)

Lane L8. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (23)

- [bookings.availability](../capabilities/bookings.availability.md): Open slots in the visitor time zone from connected calendars; unavailable when the host is disconnected
- [bookings.book](../capabilities/bookings.book.md): Public: make a booking; creates or updates a record and a meeting
- [bookings.cancel](../capabilities/bookings.cancel.md): Cancel a booking
- [bookings.list](../capabilities/bookings.list.md): List bookings of a page
- [bookings.page_create](../capabilities/bookings.page_create.md): Create a booking page with host or round-robin pool, length, buffer and questions
- [forms.attribution_get](../capabilities/forms.attribution_get.md): First source and Latest source of a record
- [forms.create](../capabilities/forms.create.md): Create a form on a record type; every input maps to a field
- [forms.delete](../capabilities/forms.delete.md): Delete a form
- [forms.design_set](../capabilities/forms.design_set.md): Set layout, theme, fonts, custom CSS, cover image, conditional logic and thank-you page or redirect
- [forms.fields_set](../capabilities/forms.fields_set.md): Set Ask, Show or Hide per field, prefill keys and multi-step grouping
- [forms.get](../capabilities/forms.get.md): Read a form with its field modes, layout, theme and logic
- [forms.link_create](../capabilities/forms.link_create.md): Make a signed or one-use form link for one record that asks only for the missing fields (no emails in URLs)
- [forms.link_revoke](../capabilities/forms.link_revoke.md): Revoke a one-use link
- [forms.list](../capabilities/forms.list.md): List forms by section and folder
- [forms.publish](../capabilities/forms.publish.md): Publish a form as a public link or embed
- [forms.save_partial](../capabilities/forms.save_partial.md): Public: keep the answers typed so far against a signed or one-use link so the person can come back; nothing reaches the record until submit
- [forms.submissions](../capabilities/forms.submissions.md): List submissions of a form
- [forms.submit](../capabilities/forms.submit.md): Public submit: writes through as principal svc_form_<id> with source link holder; consent, captcha and rate limits apply; attribution captured
- [forms.survey_results](../capabilities/forms.survey_results.md): Aggregate results of a survey
- [forms.unpublish](../capabilities/forms.unpublish.md): Close a form
- [forms.update](../capabilities/forms.update.md): Change form name, match rule, consent text, captcha toggle, upload policy and rate limits
- [source_rules.list](../capabilities/source_rules.list.md): List Source rules that map clicks to channels
- [source_rules.set](../capabilities/source_rules.set.md): Replace the Source rules

## Events (5)

- [booking.cancelled](../events/booking.cancelled.md): A booking was cancelled
- [booking.created](../events/booking.created.md): A booking was made; a record and a meeting were created or updated
- [form.link_created](../events/form.link_created.md): A one-use or signed record link was made
- [form.published](../events/form.published.md): A form went live
- [form.submitted](../events/form.submitted.md): A form was submitted; the record was written with source link holder
