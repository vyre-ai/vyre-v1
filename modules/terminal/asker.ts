// What a person who is not the agent's owner gets of a shared agent's workspace (owner, 13 Nov 2026, P7 section 10 item 6: "a turn sees only the asker's work folder plus the agent's own home"; lead, 14 Nov:
// the boundary is the operating system, not the command text). Each such person is a Unix user of their own in the container (uid 20000 to 20999, a user named u<uid> in the image), their home
// /people/u<uid> is mode 0700 and made by that uid itself, and every command, terminal and tmux call of theirs runs as that uid (Docker's exec takes a user; no capability is needed). The agent's own home
// /home/agent is 0700 owned by 10001, so for these uids it, ~/Vyre and ~/projects under it, the owner's tmux server (/tmp/tmux-10001), the owner's processes' environment and working folders, and every other
// person's home are refused by the kernel, whatever a command says. The text checks below (a path in a working directory or a command) stay as friendly words in front of that wall, not as the wall.
// The agent's owner, a person's own Assistant and a turn acting for nobody keep the agent's home as it is. What one container still shares: the process list and command lines (`ps`), /tmp (a person's
// programs use their own TMPDIR), the memory, CPU and process caps.

/** Where the homes of the people who use the agent live: a volume of its own (workspace.ts PEOPLE_GUEST). */
export const PEOPLE_DIR = "/people";

export interface AskerPlace {
  /** The person this place is for. */
  person: string;
  /** Their Unix user id and group id in the container. */
  uid: number;
  /** Their folder: HOME for their shell. */
  home: string;
  /** What their shell starts with. */
  env: Readonly<Record<string, string>>;
  /** May they read what Files shows them of the agent's folder (the mirror `~/Vyre`)? Decided from Files' own view rule when the place is made. */
  files: boolean;
}

export function askerPlace(person: string, uid: number, files = false): AskerPlace {
  const home = `${PEOPLE_DIR}/u${uid}`;
  return {
    person,
    uid,
    files,
    home,
    env: {
      HOME: home,
      HISTFILE: `${home}/.bash_history`,
      XDG_CONFIG_HOME: `${home}/.config`,
      XDG_CACHE_HOME: `${home}/.cache`,
      XDG_DATA_HOME: `${home}/.local/share`,
      XDG_STATE_HOME: `${home}/.local/state`,
      TMPDIR: `${home}/.tmp`,
      // the person's own tmux server keeps its socket in their own folder, never in the /tmp every person shares, where another person could make the folder first and stop it from starting
      TMUX_TMPDIR: `${home}/.tmux`,
    },
  };
}

/** The exit status of `ensureCommand` when the folder of this uid belongs to someone else. The image makes every folder for its own uid, so this is a fault: the uid is never given to another person (a person keeps one uid for the whole Space) and the call says so. */
export const SQUATTED = 77;

/**
 * Makes the person's folder (run AS the person's uid, so it is theirs and 0700), the shell's usual start files (from /etc/skel, never over a file that is there) and the folders programs expect. A folder that is
 * there and not owned by this uid ends with SQUATTED. Safe to run again. `sh -c`, the folder and the uid passed as arguments.
 */
export function ensureCommand(p: AskerPlace): string[] {
  return [
    "sh",
    "-c",
    'h="$1"; u="$2"; umask 077; if [ -e "$h" ]; then [ "$(stat -c %u "$h")" = "$u" ] || exit 77; else mkdir -m 700 "$h" || exit 77; [ "$(stat -c %u "$h")" = "$u" ] || exit 77; fi; ' +
      'mkdir -p "$h/.config" "$h/.cache" "$h/.local/share" "$h/.local/state" "$h/.ssh" "$h/.tmp" "$h/.tmux" && ln -sfn /shared/projects "$h/projects" && ln -sfn /shared/Vyre "$h/Vyre" && cp -rn /etc/skel/. "$h"/ 2>/dev/null; ' +
      // the first line this person reads in their terminal (lead, 14 Nov): where their files are, and that this is their own home; the agent's own home and the Files mirror are not offered to them
      '[ -e "$h/.vyre-hello" ] || { printf "%s\\n" "echo \\"Your files are in Files. This is your own home on this computer.\\"" >> "$h/.bashrc"; : > "$h/.vyre-hello"; }; true',
    "sh",
    p.home,
    String(p.uid),
  ];
}

/**
 * What reaches a person of the agent's computer, by the file system (POSIX ACLs; run as the agent's own user 10001, which owns every folder named here, so no capability is needed). A person has no search
 * permission on the agent's home at all: what they may be let into lives under /shared (outside the home; /shared, /shared/projects and /shared/chats can be passed through by anyone and listed by no one),
 * and `~/projects` and `~/Vyre` in their own home are links to it. The project folders of the projects they are on are theirs at the level the project gives (members read and write, others read), and the
 * Files mirror is theirs to read when Files lets them view the agent's folder. Every other project folder and the mirror are closed to everyone but the agent (0700) and then opened by name for who may.
 * Run again at each command of the person (when the last time is more than a few seconds ago), so a change in who is on a project is applied then. A person's new files in a folder the agent also uses carry
 * the group's rights: sessions run with umask 007.
 */
export function grantCommand(p: AskerPlace, projects: ReadonlyArray<{ id: string; write: boolean }>): string[] {
  // Every step that opens something is checked on the folder itself and fails the whole command with a line naming it (the exit status is the number of failures, the stderr says which); what is only
  // best effort is the walk through files other people made inside (the agent's own user may not change those), and taking an entry away that was never there.
  return [
    "sh",
    "-c",
    'u="$1"; files="$2"; shift 2; H=/home/agent; S=/shared; rc=0; fail() { echo "could not open $1 for the person" >&2; rc=$((rc+1)); }; ' +
      // a guest never holds search permission on the home (an entry an earlier release gave is taken away); the shared folders exist (a workspace of an older release made the image's folders by the first start)
      'setfacl -x "u:$u" "$H" 2>/dev/null; mkdir -p -m 711 "$S/projects" "$S/chats" 2>/dev/null; ' +
      'for d in "$S"/projects/* "$S/Vyre"; do [ -d "$d" ] && { chmod 700 "$d"; setfacl -R -x "u:$u" "$d" 2>/dev/null; setfacl -R -d -x "u:$u" "$d" 2>/dev/null; }; done; ' +
      '[ "$files" = 1 ] && [ -d "$S/Vyre" ] && { setfacl -m "u:$u:--x" "$S" 2>/dev/null; setfacl -m "u:$u:rX" "$S/Vyre" && setfacl -d -m "u:$u:rX" "$S/Vyre" || fail "the Files folder"; setfacl -R -m "u:$u:rX" "$S/Vyre" 2>/dev/null; setfacl -R -d -m "u:$u:rX" "$S/Vyre" 2>/dev/null; }; ' +
      'for p in "$@"; do id="${p%%:*}"; m="${p##*:}"; d="$S/projects/$id"; [ -d "$d" ] || continue; perm=rX; [ "$m" = rw ] && perm=rwX; ' +
      'setfacl -m "u:$u:$perm" "$d" && setfacl -d -m "u:$u:$perm" "$d" && setfacl -d -m u:10001:rwX "$d" || fail "project $id"; ' +
      'setfacl -R -m "u:$u:$perm" "$d" 2>/dev/null; setfacl -R -d -m "u:$u:$perm" "$d" 2>/dev/null; setfacl -R -d -m u:10001:rwX "$d" 2>/dev/null; done; exit $rc',
    "sh",
    String(p.uid),
    p.files ? "1" : "0",
    ...projects.map((x) => `${x.id}:${x.write ? "rw" : "r"}`),
  ];
}

/** The folder of one chat on an agent's computer that every person working in that chat reaches: `~/chat` in each person's place (and the agent's own home) points at it. */
export const chatFolderPath = (thread: string): string => `/shared/chats/${thread.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/**
 * Makes the shared folder of a chat (closed to everyone, 0700, the agent's own user keeping it) and, when a uid is named, opens it to that person: they may pass through /home/agent and /home/agent/chats and
 * read and write in the chat's own folder; what is made there is readable by everyone named at the time (default entries). Run at each command of a person in the chat. Who is still allowed is decided by
 * `chatReconcileCommand`, which takes the entry away again from a person who left the chat.
 */
export function chatFolderCommand(thread: string, uid?: number): string[] {
  return [
    "sh",
    "-c",
    'd="$1"; u="$2"; mkdir -p -m 711 /shared/chats 2>/dev/null; mkdir -p -m 700 "$d" || exit 1; setfacl -m u:10001:rwx "$d" && setfacl -d -m u:10001:rwX "$d" || exit 1; ' +
      // what is already there is opened to them too, as far as the agent's own user may change it (a file another person made keeps only the entries its maker gave: that is theirs to share)
      '[ -z "$u" ] || { setfacl -m "u:$u:rwX" "$d" && setfacl -d -m "u:$u:rwX" "$d" && { setfacl -R -m "u:$u:rwX" "$d" 2>/dev/null; true; }; }',
    "sh",
    chatFolderPath(thread),
    uid === undefined ? "" : String(uid),
  ];
}

/** Takes one person's entries off the shared folder of a chat they are no longer in (the folder, what is in it and the default entries); a folder that is not there is nothing to do. */
export function chatRevokeCommand(thread: string, uid: number): string[] {
  return [
    "sh",
    "-c",
    'd="$1"; u="$2"; [ -d "$d" ] || exit 0; setfacl -x "u:$u" "$d" && setfacl -d -x "u:$u" "$d" || exit 1; setfacl -R -x "u:$u" "$d" 2>/dev/null; setfacl -R -d -x "u:$u" "$d" 2>/dev/null; true',
    "sh",
    chatFolderPath(thread),
    String(uid),
  ];
}

/** Points `~/chat` at the chat's shared folder, as the person it is for (their own user, or the agent's for its owner). */
export function chatLinkCommand(thread: string, home: string): string[] {
  return ["sh", "-c", 'ln -sfn "$1" "$2/chat"', "sh", chatFolderPath(thread), home];
}

/** Takes a person's folder out of a workspace (they left the Space and the Trash time is over). Run as the person's uid: nobody else can. */
export function removeCommand(p: AskerPlace): string[] {
  // everything in the folder goes; the folder itself stays (it is the person's uid's own, made by the image, and /people is not writable by anyone)
  return ["sh", "-c", 'find "$1" -mindepth 1 -delete', "sh", p.home];
}

/** The `u<uid>` folders under /people that a path names and that are not this person's. Friendly words only: the kernel is the wall. */
export function otherFolders(text: string, uid: number): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^A-Za-z0-9_.-])\/people\/(u\d+)(?![A-Za-z0-9_])/g)) {
    if (m[1] !== `u${uid}`) found.add(m[1] ?? "");
  }
  return [...found];
}

/** Is `dir` (a working directory as given) in another person's folder? */
export const inOtherFolder = (dir: string, uid: number): boolean => otherFolders(dir, uid).length > 0;

/**
 * What the agent's home itself holds that a path names in the plain spelling `/home/agent/<name>`: the agent's own dotfiles, keys and tokens (the owner's sign-ins live there), `.bash_history`, and so on.
 * The Files mirror `Vyre` and the project folders are other rules; this lists the rest, and `""` for the home folder itself. Friendly words only.
 */
export function ownersHomeRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\/home\/agent(?![A-Za-z0-9_.-])(?:\/([^\s\/'"`;|&)<>]*))?/g)) {
    const seg = m[1] ?? "";
    if (seg === "projects" || seg === "Vyre") continue;
    out.push(seg);
  }
  return out;
}

/** Does a path name the Files mirror (`~/Vyre`, `$HOME/Vyre`, `/home/agent/Vyre`)? */
export const namesMirror = (text: string): boolean =>
  /(?:\/home\/agent|\/shared|~|\$HOME|\$\{HOME\})\/Vyre(?![A-Za-z0-9_-])/.test(text);

/** The project folders a path names: `/home/agent/projects/<id>` or `~/projects/<id>`. */
export function projectsNamed(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\/home\/agent|\/shared|~|\$HOME|\$\{HOME\})\/projects\/([A-Za-z0-9_-]+)/g))
    if (m[1]) out.add(m[1]);
  return [...out];
}
