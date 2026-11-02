---
name: forms
description: Collect answers from people outside the Space. When a Vyre form fits, when a site with its own form is better, how to build and publish one, and where the answers go.
system: true
---

# Forms

A Vyre form writes straight into Records, so it is the first choice for collecting answers.

## Which one
- Use a Vyre form when the answers belong in Records: a lead, an intake, a survey, a booking. You get consent text, rate limits, one-use links and attribution with no server.
- Build a site with its own form when the form is one part of a larger page or app, or needs logic a form cannot hold. Send its answers to Records with `records_create` from your own backend.

## Build
1. The answers need a record type. `schema_describe` to find one, or make one first.
2. `forms_create` on that record type. Every input maps to a field.
3. `forms_fields_set` chooses Ask, Show or Hide for each field, prefill keys and steps. `forms_design_set` sets the look, conditional logic and thank-you page. `forms_update` sets the name, match rule, consent text and limits.
4. Show the person the form as a visitor would see it. `forms_publish` is outward, so confirm the audience and consent text first. It returns the link and an embed.

## Where answers go
- Each answer is a record of that type, with the source "link holder". `forms_submissions` lists them. `forms_survey_results` sums a survey. `forms_attribution_get` says where a person came from.
- To act on an answer, make an automation with the form_submit trigger. Find step kinds with `automations_steps_list`.
- A link for one person that asks only what is missing: `forms_link_create`. `forms_link_revoke` ends it.
- Bookings: `bookings_page_create`, then `bookings_list`.

## Addresses
On a name.vyre.run address a form lives at `https://name.vyre.run/p/forms/<slug>`. On the Space's own domain it lives at `/f/<slug>`. Publish gives the right one. Give the person the link it returns, never one you composed.
`forms_unpublish` closes a form.
