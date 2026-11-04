# Projects (projects)

Lane L3. Kind module. Version 0.1.0.

Requires: agents, records, tasks.

## Capabilities (48)

- [projects.apply_cascade](../capabilities/projects.apply_cascade.md): Apply a cascade proposal, or keep the dates
- [projects.cascade](../capabilities/projects.cascade.md): Propose the cascade after something slips: which later tasks move and which dates still hold (an agent may call this too)
- [projects.create](../capabilities/projects.create.md): Make a project: the record, exactly one channel and one folder (Projects/<name>), and an empty plan
- [projects.crew](../capabilities/projects.crew.md): The helpers working for a project with a live state (Working, Done or Needs you) and what each is on, from the crews of the project's chats, and the project's teammates
- [projects.file_chat](../capabilities/projects.file_chat.md): File a private chat under the project; it stays private and the agent gets the project memory and folder
- [projects.files_folder](../capabilities/projects.files_folder.md): The folder that holds a record's files: a project's own, else Files > Projects > Record files > the record (made on first use unless create is false, with the record's access mirrored onto it)
- [projects.for_channel](../capabilities/projects.for_channel.md): The project a channel belongs to, if there is one the caller may see
- [projects.from_channel](../capabilities/projects.from_channel.md): Make this channel a project: create the record and attach the channel, a folder and an empty plan
- [projects.get](../capabilities/projects.get.md): Read one project: record fields, channel, folder and counts
- [projects.link_tasks](../capabilities/projects.link_tasks.md): Add a dependency arrow between two tasks
- [projects.links.link](../capabilities/projects.links.link.md): Link something to a project; an agent that may edit the project can too. A web address or CI run may bring its own state, label and address
- [projects.links.list](../capabilities/projects.links.list.md): What is linked to a project (records, files, chats, tasks, artifacts, mail threads, calendar events, pull requests, commits, CI runs, web addresses), each with its state read live from the source, and the rules that link by themselves
- [projects.links.rules.set](../capabilities/projects.links.rules.set.md): Set the rules that link matching new items to the project: a repository, a record filter or an email domain
- [projects.links.unlink](../capabilities/projects.links.unlink.md): Take a link off a project; an item a rule linked is remembered as an exception and never comes back by rule
- [projects.list](../capabilities/projects.list.md): List the projects the caller is in (Agents, Projects and Journeys show only those you are in)
- [projects.live_block.query](../capabilities/projects.live_block.query.md): Evaluate a live block for the reader: the rows they may open, how many they may not (hidden), and for a metric its value. The block stores only its spec
- [projects.members.list](../capabilities/projects.members.list.md): List people and agents on a project with their roles
- [projects.members.remove](../capabilities/projects.members.remove.md): Remove a project role and revoke its grants by source
- [projects.members.set](../capabilities/projects.members.set.md): Give a person, agent or group a project role: Lead, Member, Reviewer or Guest (an agent with a role is a teammate there)
- [projects.open_task_thread](../capabilities/projects.open_task_thread.md): Open the thread of a task in the project channel (made when someone first speaks about the task)
- [projects.overview](../capabilities/projects.overview.md): The Overview: brief and goal, status with its update, next three milestones, what is late or waiting, recent decisions, people, linked records, pinned files, recent threads
- [projects.overview_doc.apply_template](../capabilities/projects.overview_doc.apply_template.md): Put a template's blocks on a project's Overview, replacing the page (one revision, so Undo brings the old page back)
- [projects.overview_doc.get](../capabilities/projects.overview_doc.get.md): The Overview page: its blocks (text, headings and live blocks that hold only a spec), its revision and the project's custom fields for the page header
- [projects.overview_doc.history](../capabilities/projects.overview_doc.history.md): The Overview's revisions, newest first, each with who made it and what changed
- [projects.overview_doc.save](../capabilities/projects.overview_doc.save.md): Save the whole Overview page from the editor, as Markdown (or blocks); baseRev is the revision it was opened at, and a page changed since says so instead of overwriting
- [projects.overview_doc.templates.list](../capabilities/projects.overview_doc.templates.list.md): The Space's Overview page templates: Client account, Software project and Hiring, and any saved since
- [projects.overview_doc.templates.save](../capabilities/projects.overview_doc.templates.save.md): Save a page template for the Space, from a project's Overview or from blocks; an agent can too
- [projects.overview_doc.undo](../capabilities/projects.overview_doc.undo.md): Undo the latest change to the Overview: the blocks and any property it set go back as they were; the undo is a revision too
- [projects.overview_edit](../capabilities/projects.overview_edit.md): Edit the Overview by ops: insert, update, move, delete a block, or set_property on a custom field of the project. One revision for the call, carrying its author; an agent's edit leaves one quiet line in the project channel
- [projects.overview_get](../capabilities/projects.overview_get.md): Read the Overview as Markdown with every block led by its id, the project's custom fields and the kinds of live block, so overview_edit can name what to change
- [projects.pin_file](../capabilities/projects.pin_file.md): Pin a file to the Overview
- [projects.plan](../capabilities/projects.plan.md): The plan: stages, tasks, milestones, dependency links and a today marker; one payload for Timeline, Board, List and Calendar
- [projects.post_update](../capabilities/projects.post_update.md): Post the status update (by the lead, or drafted weekly by an agent) to the project channel and keep it on the Overview
- [projects.reschedule](../capabilities/projects.reschedule.md): Move a task bar or resize it on the timeline; if it slips, the response carries a cascade proposal
- [projects.roles_of](../capabilities/projects.roles_of.md): The projects where one person holds a role, and which role, limited to the projects the asker can see
- [projects.set](../capabilities/projects.set.md): Set how the project stands (On track, At risk, Off track, On hold or Done) by hand, or null to go back to the reading from the late tasks; audited, and the Overview says who set it
- [projects.share_out](../capabilities/projects.share_out.md): Make a read-only link to the project Overview for a client; it expires in 30 days unless expiresAt or expiresInDays says otherwise
- [projects.shared_view](../capabilities/projects.shared_view.md): System: what a shared link shows a client (title, status, goal, status update, next milestones; no people, threads or files). Only the host calls it, for /share/project/<token>
- [projects.stages.set](../capabilities/projects.stages.set.md): Create, rename, reorder or remove the stages of a plan
- [projects.teammates.create](../capabilities/projects.teammates.create.md): Make a teammate for this project: an agent with no computer and a project role (Lead, Member or Reviewer), by one yes; it shows on the Teammates tab, not on the Agents page
- [projects.teammates.list](../capabilities/projects.teammates.list.md): The teammates of a project: agents with a role there, with the lead first. The lead is the default participant in a new chat in the project.
- [projects.teammates.remove](../capabilities/projects.teammates.remove.md): Take a teammate off the project; one made for this project moves to Trash with it
- [projects.templates.list](../capabilities/projects.templates.list.md): Project templates: record types derived from Project and template projects from installed Kits
- [projects.unlink_tasks](../capabilities/projects.unlink_tasks.md): Remove a dependency arrow
- [projects.unpin_file](../capabilities/projects.unpin_file.md): Unpin a file from the Overview
- [projects.unshare_out](../capabilities/projects.unshare_out.md): Revoke a read-only link to the project Overview; the link answers not found at once
- [projects.update.draft](../capabilities/projects.update.draft.md): Draft the status update again from the project facts, on the asker's own AI account; it is kept as the draft and posted only by Post
- [projects.update.edit](../capabilities/projects.update.edit.md): Edit the status update's draft in place

## Events (24)

- [project.cascade_applied](../events/project.cascade_applied.md): A cascade proposal was applied
- [project.cascade_proposed](../events/project.cascade_proposed.md): The plan proposed moving later tasks after a slip
- [project.chat_filed](../events/project.chat_filed.md): A private chat was filed under a project (it stays private)
- [project.created](../events/project.created.md): A project was made with its channel, folder and empty plan
- [project.dates_kept](../events/project.dates_kept.md): A cascade proposal was declined and dates were kept
- [project.file_pinned](../events/project.file_pinned.md): A file was pinned to the Overview
- [project.file_unpinned](../events/project.file_unpinned.md): A pinned file was removed from the Overview
- [project.health_set](../events/project.health_set.md): A manager set how the project stands, or went back to the automatic reading
- [project.item_linked](../events/project.item_linked.md): Something was linked to a project, by a person, an agent or a rule
- [project.item_unlinked](../events/project.item_unlinked.md): A link was taken off a project
- [project.link_rules_set](../events/project.link_rules_set.md): The rules that link matching new items to a project changed
- [project.member_removed](../events/project.member_removed.md): A project role was removed and its grants revoked
- [project.member_set](../events/project.member_set.md): A person or agent was given a project role
- [project.overview_edited](../events/project.overview_edited.md): The Overview page changed (an edit, a save, an applied template or an undo), by a person or an agent
- [project.overview_template_saved](../events/project.overview_template_saved.md): A page template was saved for the Space
- [project.shared_out](../events/project.shared_out.md): A read-only link to the project Overview was made
- [project.stages_changed](../events/project.stages_changed.md): The stages of a plan changed
- [project.task_rescheduled](../events/project.task_rescheduled.md): A task moved or was resized on the timeline
- [project.task_thread_opened](../events/project.task_thread_opened.md): A task got its thread in the project channel
- [project.tasks_linked](../events/project.tasks_linked.md): A dependency was added between two tasks
- [project.tasks_unlinked](../events/project.tasks_unlinked.md): A dependency was removed
- [project.unshared_out](../events/project.unshared_out.md): A read-only link to the project Overview was revoked
- [project.update_drafted](../events/project.update_drafted.md): The status update has a new draft (written from the project facts, or edited in place)
- [project.update_posted](../events/project.update_posted.md): A status update was posted to the project channel
