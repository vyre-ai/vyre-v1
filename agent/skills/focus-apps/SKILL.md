---
name: focus-apps
description: Work in Apps. Sites, Forms, Campaigns, Templates and Kits, the email builder; build, preview, then publish through the Gate.
system: true
---

# Apps

Apps holds what the Space puts in front of the outside world: Sites, Forms and booking pages, Campaigns, and the Templates and Kits that install a way of working.
Public things are outward acts. Build and preview freely; publish and launch only with the person's word.

## Sites
Sites comes in a later version. Use what follows only when these tools are in your tool list; when they are not, tell the person Sites is not in this version yet.
- `sites_list`, `sites_get`, `sites_deployments`, `sites_logs`. A site is built from its repo: `sites_build` runs the build in the repo, `sites_deploy` puts it on a
  password-protected staging address, `sites_previews` lists one preview per branch. Show the person the staging address before you promote.
- `sites_promote` sends staging to production and is held for approval. `sites_rollback` goes back. Say what changed between the two.
- Site tables are record types owned by the site (`sites_tables`). Environment names come from the Vault (`sites_env_set`); never write a value.

## Forms
- `forms_create` on a record type: every input maps to a field. `forms_fields_set` chooses Ask, Show or Hide per field, prefill keys and steps.
  `forms_design_set` for look. `forms_publish` makes a public link or embed: outward, so confirm the audience and the consent text first.
- `forms_submissions` reads answers; `forms_survey_results` sums a survey. A form answer is a record with the source "link holder".
- To change a form's source (HTML, CSS, JavaScript) with the person watching, use `forms_ask_diff`: it returns a per-field diff they accept one by one. Nothing saves until they do.

## Campaigns
- `campaigns_create`, `campaigns_audience_set` from a record view (adds are screened for DND), `campaigns_steps_set` (email, wait, branch, SMS, task, call task),
  `campaigns_schedule_set` (windows per recipient zone, throttle, stop on reply), `campaigns_preview`, `campaigns_stats`.
- `campaigns_launch` is held for approval whoever asks. Before you ask for it, show the audience count, the first email, the schedule and who approves.
- The email builder: `email_builder_create`, `email_builder_save`, `email_builder_render`, `email_builder_send_test`. Send a test to the person, never to the audience.
  Large edits go as `email_builder_ask_diff`, a diff the author accepts per change.

## Templates and Kits
- `templates_list` and `templates_preview` show what a template adds before it installs. `kits_install_sheet` lists the tools, record types, domains and Vault names a Kit needs.
  `kits_install` needs the person's yes. `kits_rollback` goes back one version.

## Habits
- Describe a public thing as the visitor would see it. Give the preview address, not just the id.
