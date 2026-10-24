# Terminal (terminal)

Lane L2. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (16)

- [terminal.attach](../capabilities/terminal.attach.md): Attach to a session as a live stream; the same session an agent used, so Open terminal shows its commands
- [terminal.close](../capabilities/terminal.close.md): Close a session and kill its tmux session
- [terminal.get](../capabilities/terminal.get.md): Read one terminal session: host, state, working folder, last exit code
- [terminal.health](../capabilities/terminal.health.md): Health of tmux and the session relay on the host
- [terminal.input](../capabilities/terminal.input.md): Send keystrokes to a session (a person typing in the terminal tab; output returns as live frames)
- [terminal.interrupt](../capabilities/terminal.interrupt.md): Send Ctrl-C to a session
- [terminal.list](../capabilities/terminal.list.md): List terminal sessions you can see, including named leftover scripts
- [terminal.open](../capabilities/terminal.open.md): Open a terminal session on an agent computer or on your own computer (the device daemon)
- [terminal.open_server](../capabilities/terminal.open_server.md): Open a shell on the Space server (needs server.services; locked state with Ask for access otherwise)
- [terminal.read](../capabilities/terminal.read.md): Read the scrollback of a session (secrets already scrubbed)
- [terminal.rename](../capabilities/terminal.rename.md): Name a session so it can be found and starred (leftover scripts become named sessions)
- [terminal.resize](../capabilities/terminal.resize.md): Resize the terminal window
- [terminal.rules.get](../capabilities/terminal.rules.get.md): Your allow, ask and deny rules and the folders the terminal is locked to
- [terminal.rules.set](../capabilities/terminal.rules.set.md): Change your allow, ask and deny rules and the extra folders (a Personal Space terminal is locked to its own folder plus these)
- [terminal.run](../capabilities/terminal.run.md): Run a command in a session and wait for it (the terminal_run tool); secrets only as #Handle.field; output is scrubbed before it returns
- [terminal.status](../capabilities/terminal.status.md): Live status of terminals for Home (state and last line read from tmux)

## Events (5)

- [terminal.closed](../events/terminal.closed.md): A terminal session was closed
- [terminal.command_finished](../events/terminal.command_finished.md): A command finished (exit code and duration only, never the command or output)
- [terminal.opened](../events/terminal.opened.md): A terminal session was opened
- [terminal.renamed](../events/terminal.renamed.md): A terminal session was renamed
- [terminal.rules_changed](../events/terminal.rules_changed.md): A person changed their terminal rules
