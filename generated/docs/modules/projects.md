# Projects (projects)

Lane L3. Kind module. Version 0.1.0.

Requires: records, tasks.

## Capabilities (24)

- [projects.apply_cascade](../capabilities/projects.apply_cascade.md): Apply a cascade proposal, or keep the dates
- [projects.cascade](../capabilities/projects.cascade.md): Propose the cascade after something slips: which later tasks move and which dates still hold (an agent may call this too)
- [projects.create](../capabilities/projects.create.md): Make a project: the record, exactly one channel and one folder (Projects/<name>), and an empty plan
- [projects.file_chat](../capabilities/projects.file_chat.md): File a private chat under the project; it stays private and the agent gets the project memory and folder
- [projects.from_channel](../capabilities/projects.from_channel.md): Make this channel a project: create the record and attach the channel, a folder and an empty plan
- [projects.get](../capabilities/projects.get.md): Read one project: record fields, channel, folder and counts
- [projects.link_tasks](../capabilities/projects.link_tasks.md): Add a dependency arrow between two tasks
- [projects.list](../capabilities/projects.list.md): List the projects the caller is in (Agents, Projects and Journeys show only those you are in)
- [projects.members.list](../capabilities/projects.members.list.md): List people and agents on a project with their roles
- [projects.members.remove](../capabilities/projects.members.remove.md): Remove a project role and revoke its grants by source
- [projects.members.set](../capabilities/projects.members.set.md): Give a person, agent or group a project role: Lead, Member, Reviewer or Guest (an agent with a role is a teammate there)
- [projects.open_task_thread](../capabilities/projects.open_task_thread.md): Open the thread of a task in the project channel (made when someone first speaks about the task)
- [projects.overview](../capabilities/projects.overview.md): The Overview: brief and goal, status with its update, next three milestones, what is late or waiting, recent decisions, people, linked records, pinned files, recent threads
- [projects.pin_file](../capabilities/projects.pin_file.md): Pin a file to the Overview
- [projects.plan](../capabilities/projects.plan.md): The plan: stages, tasks, milestones, dependency links and a today marker; one payload for Timeline, Board, List and Calendar
- [projects.post_update](../capabilities/projects.post_update.md): Post the status update (by the lead, or drafted weekly by an agent) to the project channel and keep it on the Overview
- [projects.reschedule](../capabilities/projects.reschedule.md): Move a task bar or resize it on the timeline; if it slips, the response carries a cascade proposal
- [projects.share_out](../capabilities/projects.share_out.md): Make a read-only link to the project Overview for a client; it expires in 30 days unless expiresAt or expiresInDays says otherwise
- [projects.shared_view](../capabilities/projects.shared_view.md): System: what a shared link shows a client (title, status, goal, status update, next milestones; no people, threads or files). Only the host calls it, for /share/project/<token>
- [projects.stages.set](../capabilities/projects.stages.set.md): Create, rename, reorder or remove the stages of a plan
- [projects.templates.list](../capabilities/projects.templates.list.md): Project templates: record types derived from Project and template projects from installed Kits
- [projects.unlink_tasks](../capabilities/projects.unlink_tasks.md): Remove a dependency arrow
- [projects.unpin_file](../capabilities/projects.unpin_file.md): Unpin a file from the Overview
- [projects.unshare_out](../capabilities/projects.unshare_out.md): Revoke a read-only link to the project Overview; the link answers not found at once

## Events (17)

- [project.cascade_applied](../events/project.cascade_applied.md): A cascade proposal was applied
- [project.cascade_proposed](../events/project.cascade_proposed.md): The plan proposed moving later tasks after a slip
- [project.chat_filed](../events/project.chat_filed.md): A private chat was filed under a project (it stays private)
- [project.created](../events/project.created.md): A project was made with its channel, folder and empty plan
- [project.dates_kept](../events/project.dates_kept.md): A cascade proposal was declined and dates were kept
- [project.file_pinned](../events/project.file_pinned.md): A file was pinned to the Overview
- [project.file_unpinned](../events/project.file_unpinned.md): A pinned file was removed from the Overview
- [project.member_removed](../events/project.member_removed.md): A project role was removed and its grants revoked
- [project.member_set](../events/project.member_set.md): A person or agent was given a project role
- [project.shared_out](../events/project.shared_out.md): A read-only link to the project Overview was made
- [project.stages_changed](../events/project.stages_changed.md): The stages of a plan changed
- [project.task_rescheduled](../events/project.task_rescheduled.md): A task moved or was resized on the timeline
- [project.task_thread_opened](../events/project.task_thread_opened.md): A task got its thread in the project channel
- [project.tasks_linked](../events/project.tasks_linked.md): A dependency was added between two tasks
- [project.tasks_unlinked](../events/project.tasks_unlinked.md): A dependency was removed
- [project.unshared_out](../events/project.unshared_out.md): A read-only link to the project Overview was revoked
- [project.update_posted](../events/project.update_posted.md): A status update was posted to the project channel
