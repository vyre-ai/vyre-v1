---
name: focus-apps
description: Work in Apps. Sites, Forms, Templates and Kits, the email builder; build, preview, then publish once a person approves.
system: true
---

# Apps

Apps holds what the Space puts in front of the outside world: Sites, Forms and booking pages, and the Templates and Kits that install a way of working.
Public things are outward acts. Build and preview freely; publish only with the person's word.

## Sites
- A site is a route: you build and run anything on a computer, Vyre gives it an address. Load the `sites` skill before you start.
- `sites_create`, `sites_status`, `sites_logs`, `sites_stop`. Going public is `sites_promote`, held for a yes unless the person asked this turn. Custom domains: `sites_domain_add`, `sites_domain_check`.
- To show the person something private, use `artifact_publish` (the `artifacts` skill).

## Forms
- Load the `forms` skill. `forms_create` on a record type, `forms_fields_set`, `forms_design_set`, `forms_publish` (outward, so confirm the audience and the consent text first), `forms_submissions`.
- To change a form's source (HTML, CSS, JavaScript) with the person watching, use `forms_ask_diff`: it returns a per-field diff they accept one by one. Nothing saves until they do.

## Email designs
- The email builder: `email_builder_create`, `email_builder_save`, `email_builder_render`, `email_builder_send_test`. Send a test to the person, never to the audience.
  Large edits go as `email_builder_ask_diff`, a diff the author accepts per change.
- Regular email to contacts is an Automation: a welcome, a nurture series, an appointment confirmation, a newsletter. Build it with the send email step. Vyre does not do cold email.

## Templates and Kits
- `templates_list` and `templates_preview` show what a template adds before it installs. `kits_install_sheet` lists the tools, record types, domains and Vault names a Kit needs.
  `kits_install` needs the person's yes. `kits_rollback` goes back one version.

## Habits
- Describe a public thing as the visitor would see it. Give the preview address, not just the id.
