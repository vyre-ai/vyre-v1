# Agent computers (computers)

Lane L2. Kind module. Status stub. Version 0.1.0.

Requires: chat.

## Capabilities (58)

- [computers.chrome.act](../capabilities/computers.chrome.act.md): Act on an element or key: click, hover, press, select, scroll, check; a send, post or payment is held and returns an id
- [computers.chrome.api](../capabilities/computers.chrome.api.md): Call a site backend with the session of this browser; non-GET calls pass the Gate
- [computers.chrome.batch](../capabilities/computers.chrome.batch.md): Run several Chrome steps in one call; stops at the first held item
- [computers.chrome.click](../capabilities/computers.chrome.click.md): Click an element by ref or by coordinates
- [computers.chrome.console](../capabilities/computers.chrome.console.md): Read the page console messages
- [computers.chrome.eval](../capabilities/computers.chrome.eval.md): Run a JavaScript expression in the page and return the result
- [computers.chrome.fill](../capabilities/computers.chrome.fill.md): Fill form fields; values may be #Handle.field references that the computer vault filler substitutes at the last moment
- [computers.chrome.inspect](../capabilities/computers.chrome.inspect.md): Inspect one element: attributes, computed text, box and role
- [computers.chrome.net](../capabilities/computers.chrome.net.md): Read network requests of the tab with timing; bodies are masked by the vault scrubber
- [computers.chrome.open](../capabilities/computers.chrome.open.md): Open a URL, reusing the open tab by default (never one tab per step)
- [computers.chrome.plan](../capabilities/computers.chrome.plan.md): Tell the person the steps about to be taken in the browser before taking them
- [computers.chrome.resume](../capabilities/computers.chrome.resume.md): Resume after a stop or an Esc press once the person has answered
- [computers.chrome.screenshot](../capabilities/computers.chrome.screenshot.md): Screenshot of the tab or one element, stored in the agent folder and rendered as a screenshot block
- [computers.chrome.send](../capabilities/computers.chrome.send.md): Send a held send, post or payment: the person approves it first (Gate)
- [computers.chrome.snapshot](../capabilities/computers.chrome.snapshot.md): Read the page as an accessibility tree with element refs; prefer this over screenshots
- [computers.chrome.sources](../capabilities/computers.chrome.sources.md): List scripts, requests and storage a page uses (to work out backend calls for a recipe)
- [computers.chrome.state](../capabilities/computers.chrome.state.md): URL, title and load state of a tab
- [computers.chrome.status](../capabilities/computers.chrome.status.md): Status of Vyre for Chrome in this computer: connected, paused by Esc, held items
- [computers.chrome.stop](../capabilities/computers.chrome.stop.md): Stop everything Chrome is doing until the person answers
- [computers.chrome.tabs](../capabilities/computers.chrome.tabs.md): List, use, open or close tabs
- [computers.chrome.type](../capabilities/computers.chrome.type.md): Type text into the focused element or a ref; secrets only as #Handle.field references
- [computers.chrome.wait](../capabilities/computers.chrome.wait.md): Wait for a load, text, selector, network idle or a time
- [computers.configure](../capabilities/computers.configure.md): Change the tab limit or idle sleep of a computer
- [computers.files.delete](../capabilities/computers.files.delete.md): Delete a file from the agent Files folder; always asks outside work/
- [computers.files.list](../capabilities/computers.files.list.md): List a folder of the agent Files folder as seen on the computer
- [computers.files.move](../capabilities/computers.files.move.md): Move or rename a file in the agent Files folder
- [computers.files.read](../capabilities/computers.files.read.md): Read a file from the agent Files folder on the computer
- [computers.files.write](../capabilities/computers.files.write.md): Write a file in the agent Files folder (downloads, drafts, work/)
- [computers.get](../capabilities/computers.get.md): Read one agent computer: state, caption, tabs, disk and who took over
- [computers.give_back](../capabilities/computers.give_back.md): Give the computer back to the agent
- [computers.health](../capabilities/computers.health.md): Health of the container runtime and agentd on the host
- [computers.list](../capabilities/computers.list.md): List agent computers with state, tabs, disk and last activity
- [computers.provision](../capabilities/computers.provision.md): Give an agent a computer (none unless the agent needs one)
- [computers.record_start](../capabilities/computers.record_start.md): Record while you take over: every click and key with the element, each page, network traffic with secrets masked, and video
- [computers.record_stop](../capabilities/computers.record_stop.md): Stop recording; the recording is saved in work/recordings/ and one sheet asks what the agent should do with it
- [computers.recording.delete](../capabilities/computers.recording.delete.md): Delete a recording
- [computers.recording.get](../capabilities/computers.recording.get.md): Read one recording: events, network log and video paths (follows the folder access)
- [computers.recording.process](../capabilities/computers.recording.process.md): Say what the agent should do with a recording: make a skill, learn a routine, work out the app backend calls (site recipe note), learn this workflow
- [computers.recordings.list](../capabilities/computers.recordings.list.md): Recordings stored in the agent folder
- [computers.remove](../capabilities/computers.remove.md): Remove an agent computer and its profile disk
- [computers.screen.click](../capabilities/computers.screen.click.md): Click at screen coordinates
- [computers.screen.drag](../capabilities/computers.screen.drag.md): Drag from one point to another
- [computers.screen.key](../capabilities/computers.screen.key.md): Press a key or combination
- [computers.screen.move](../capabilities/computers.screen.move.md): Move the pointer
- [computers.screen.screenshot](../capabilities/computers.screen.screenshot.md): Screenshot of the whole desktop
- [computers.screen.scroll](../capabilities/computers.screen.scroll.md): Scroll at a point
- [computers.screen.type](../capabilities/computers.screen.type.md): Type text on the desktop; secrets only as #Handle.field references
- [computers.screen.wait](../capabilities/computers.screen.wait.md): Wait a number of milliseconds
- [computers.screenshot](../capabilities/computers.screenshot.md): One screenshot of the computer, stored in the agent folder
- [computers.session.sign_out](../capabilities/computers.session.sign_out.md): Sign out of a site on the profile disk
- [computers.sessions.list](../capabilities/computers.sessions.list.md): Signed-in browser sessions on the profile disk (listed under Sessions and devices)
- [computers.skill_from_step](../capabilities/computers.skill_from_step.md): Make a skill from this point in a session: starts a turn that writes the skill into the agent folder
- [computers.sleep](../capabilities/computers.sleep.md): Put a computer to sleep; refused while a task is running
- [computers.stream](../capabilities/computers.stream.md): Live view source: WebRTC through the host, or MJPEG over the WebSocket as fallback; frames are live-only, never stored
- [computers.take_over](../capabilities/computers.take_over.md): Take over the computer ("You're in control"); your actions become one "You took over" step
- [computers.timeline](../capabilities/computers.timeline.md): Session timeline: a frame per step with caption (Show This Step, Copy Caption, Make a Skill from Here)
- [computers.timeline_step](../capabilities/computers.timeline_step.md): One timeline step with its frame
- [computers.wake](../capabilities/computers.wake.md): Wake an asleep computer (it sleeps when idle and never mid-task)

## Events (12)

- [computer.configured](../events/computer.configured.md): A computer tab limit or idle sleep changed
- [computer.given_back](../events/computer.given_back.md): A person gave a computer back to the agent
- [computer.provisioned](../events/computer.provisioned.md): An agent was given a computer
- [computer.recording_processed](../events/computer.recording_processed.md): A recording was turned into a skill, routine, recipe or workflow task
- [computer.recording_saved](../events/computer.recording_saved.md): A recording was saved in the agent folder
- [computer.recording_started](../events/computer.recording_started.md): A recording started while a person has the computer
- [computer.removed](../events/computer.removed.md): An agent computer was removed
- [computer.session_signed_out](../events/computer.session_signed_out.md): A site session on the profile disk was signed out
- [computer.skill_requested](../events/computer.skill_requested.md): A skill was requested from a point in a session
- [computer.slept](../events/computer.slept.md): A computer went to sleep
- [computer.started](../events/computer.started.md): A computer woke
- [computer.takeover](../events/computer.takeover.md): A person took over a computer
