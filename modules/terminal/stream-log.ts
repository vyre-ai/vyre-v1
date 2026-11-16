// The live view of an agent's terminal reads what tmux pipes out of the pane (`tmux pipe-pane`) from a file in the agent's workspace. That file used to sit in /tmp as a plain file anyone on the
// computer could read, and kept the whole history, unscrubbed: a key in an environment line or a token in a curl stayed in it. Now:
//   - the file lives in a folder only the session's own user can open (mode 700, made under umask 077, owned by that user, never a link), and the file itself is 600;
//   - it holds only what has not been read yet: each read removes what it took (the file is emptied once the reader has caught up), so no history is kept;
//   - what the reader takes passes through the same scrubber a chat's step lines use (the Vault's) before it goes anywhere (impl.ts attach), and the typed wrapper line of terminal.run is hidden;
//   - it is removed when the session's last viewer leaves, when the session closes and when the workspace is swept.
// The scripts are plain sh, run in the workspace; they are exported so a test runs them as they are.
export const STREAM_DIR = "/tmp/.vyre-stream-$(id -u)";

/** Make the private folder (or fail when the name belongs to someone else or is a link). Ends with the folder in $d. */
const PRIVATE = `umask 077; d=${STREAM_DIR}; mkdir -p -m 700 "$d" 2>/dev/null; [ -d "$d" ] && [ ! -L "$d" ] && [ -O "$d" ] || exit 1; chmod 700 "$d"`;

/** The file's name in the folder: the session's own name, which is made of letters, digits, - and _ only. */
export const streamFile = (session: string): string => session.replace(/[^A-Za-z0-9_-]/g, "_");

/** Start: args are the session name and the file name. */
export const START_SCRIPT = `${PRIVATE}; f="$d/$2"; : > "$f"; chmod 600 "$f"; tmux pipe-pane -t "$1" "cat >> '$f'"`;
/** Read what has not been read: args are the offset already taken, and the file name. Prints the bytes (base64) and then T when the file was emptied (the next offset is 0) or K. */
export const READ_SCRIPT = `d=${STREAM_DIR}; f="$d/$2"; o="$1"; [ -f "$f" ] || exit 0; n=$(stat -c %s "$f") || exit 0; [ "$n" -gt "$o" ] || exit 0; k=$((n-o)); [ "$k" -gt 49152 ] && k=49152; tail -c +"$((o+1))" "$f" | head -c "$k" | base64 -w0; echo; if [ "$((o+k))" -eq "$(stat -c %s "$f")" ]; then : > "$f"; echo T; else echo K; fi`;
/** Stop: end the pipe and remove the file. Args: the session name and the file name. */
export const STOP_SCRIPT = `d=${STREAM_DIR}; tmux pipe-pane -t "$1" 2>/dev/null; rm -f "$d/$2"`;
/** Remove every log in the folder (a sweep of what a run left before a restart). */
export const SWEEP_SCRIPT = `d=${STREAM_DIR}; rm -f "$d"/* 2>/dev/null; true`;

/** What a read printed: the bytes and whether the file was emptied. */
export function parseRead(stdout: string): { bytes: Buffer; emptied: boolean } {
  const [b64 = "", flag = ""] = stdout.split("\n");
  return { bytes: Buffer.from(b64.trim(), "base64"), emptied: flag.trim() === "T" };
}

/**
 * The typed wrapper line of terminal.run is never shown to the person watching live. The line is typed in one go or in a few frames, so a frame that holds the start of it waits (up to 16 KB) until its
 * end arrives, and the whole is shown as the bare command, the same way a screen read is (projections.ts hideRunLine). Anything without the wrapper passes through at once.
 */
export function createRunLineFilter(hide: (text: string) => string): { push(frame: string): string; flush(): string } {
  const START = " printf '%s"; // the typed line starts with a space (the shell keeps it out of its history)
  let held = "";
  const CAP = 16_384;
  return {
    push(frame) {
      const all = held + frame;
      if (all.includes("__VYRE_") || all.includes(START)) {
        const ended = all.includes("unset __vyre_rc") && /unset __vyre_rc[^\n]*\n/.test(all);
        if (!ended && all.length < CAP) {
          held = all;
          return "";
        }
        held = "";
        return hide(all);
      }
      // the last few characters may be the start of the wrapper: they wait for the next frame
      for (let n = Math.min(START.length - 1, all.length); n > 0; n--) {
        const tail = all.slice(all.length - n);
        if ((n >= 2 && START.startsWith(tail)) || "__VYRE_".startsWith(tail)) {
          held = all.slice(all.length - n);
          return all.slice(0, all.length - n);
        }
      }
      held = "";
      return all;
    },
    flush() {
      const out = held === "" ? "" : hide(held);
      held = "";
      return out;
    },
  };
}
