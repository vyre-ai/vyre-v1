// computers (lane L2): agent computers (Team Space only). One sealed container per agent, headless Chrome by default, full desktop on demand.
// Sources: spec 2.7 and 3.2 (Computer popup); ARCHITECTURE-V1.md 6.6 (sandbox images), 6.7 (local tools), 6.11 (vault handles on the computer),
// 7.2 (agent computer detail, recording). Tools: Chrome (Vyre for Chrome), Screen, Files. Terminal is module terminal.
// DECISION: the chrome, screen and files tools are capabilities in toolset 'computer' with `mcpName` set; handlers delegate to `agentd` on the
//   agent computer (host) or to the Chrome bridge (device). They are capabilities so they authorize and audit like everything else.
// DECISION: `computerId` is optional on every tool input; an agent that omits it uses its own computer, a person must pass it.
// DECISION: chrome_ghl of the old extension is workflow specific and is not part of the industry neutral toolset; chrome_api and chrome_sources stay.
// DECISION: Gate: chrome_send is the held send (post, message, payment) that the person approves; chrome_api posts through the Gate when it is not a GET.
//   The act kind is fixed per capability, so a held payment click is reported through chrome_send with the send act.
// DECISION: files tool names are computer_files_* so they never collide with the Files module tools (files_*).
// DECISION: tab limit and idle sleep defaults are unspecified in the spec; 8 tabs and 10 minutes are the plainest choices.
// NOT EXPRESSIBLE: the executor (host agentd or device bridge) is not a capability field; see module agents for AgentToolDef.local.
import { block, create, defineManifest, ev, health, outward, read, screen, setting, t, write } from '../packages/contracts/src/index.ts';
import type { CapOpts } from '../packages/contracts/src/index.ts';
import { id, pageIn, pageOut } from './_common.ts';

const cmpState = t.enm('provisioning', 'asleep', 'waking', 'working', 'takeover', 'error');
const computerRow = t.obj({
  computerId: id.computer, agentId: id.agent, state: cmpState, caption: t.opt(t.str({ description: 'What it is doing, shown under the live view' })), tabs: t.int(), tabLimit: t.int(),
  host: t.enm('server', 'vm'), diskBytes: t.opt(t.int()), lastFrameAt: t.opt(t.ts()), lastActiveAt: t.opt(t.ts()), takeoverBy: t.opt(id.user), recording: t.bool(),
});
const stepRow = t.obj({ stepId: t.id('stp'), idx: t.int(), at: t.ts(), caption: t.str(), tool: t.str(), frameFileId: t.opt(id.file), by: t.enm('agent', 'person'), runId: t.opt(id.run) });
const recordingRow = t.obj({
  recordingId: t.id('rcd'), computerId: id.computer, agentId: id.agent, startedAt: t.ts(), endedAt: t.opt(t.ts()), durationMs: t.opt(t.int()), folderPath: t.str({ examples: ['work/recordings/rcd_a1b2c3'] }),
  state: t.enm('recording', 'saved', 'processed'), intents: t.arr(t.str()),
});
const sessionRow = t.obj({ site: t.str({ examples: ['app.example.com'] }), signedInAs: t.opt(t.str()), since: t.ts(), lastSeen: t.ts() });
const comp = { computerId: id.computer };
const optComp = { computerId: t.opt(id.computer) };
const tabId = t.opt(t.str({ description: 'Chrome tab id; omit for the active tab' }));
const ref = t.str({ description: 'Element reference from chrome_snapshot', examples: ['e12'] });
const intent = t.enm('make_skill', 'learn_routine', 'work_out_backend_calls', 'learn_workflow');

/** Local tool capability on the agent computer: bound to the computer resource, Team Space only, never queued offline. */
const local = (extra: Partial<CapOpts> = {}): CapOpts => ({
  on: ['computer', '/computerId'], perm: 'computers.use', team: true, tool: 'computer', offline: 'online', errors: ['provider.unavailable', 'timeout.deadline'], ...extra,
});

export default defineManifest({
  id: 'computers',
  title: 'Agent computers',
  owner: 'L2',
  capabilities: [
    // ---- lifecycle and control
    read('computers.list', 'List agent computers with state, tabs, disk and last activity', {
      in: { state: t.opt(t.arr(cmpState)), ...pageIn }, out: { computers: t.arr(computerRow), ...pageOut }, perm: 'computers.watch', team: true, tool: 'computer', label: 'filter',
    }),
    read('computers.get', 'Read one agent computer: state, caption, tabs, disk and who took over', {
      in: comp, out: { computer: computerRow }, on: ['computer', '/computerId'], perm: 'computers.watch', team: true, tool: 'computer', errors: ['validation.not_found'],
    }),
    create('computers.provision', 'Give an agent a computer (none unless the agent needs one)', {
      in: { agentId: id.agent, tabLimit: t.opt(t.int({ minimum: 1, maximum: 50 })) }, out: { computer: computerRow }, perm: 'computers.use', level: 'manage', team: true,
      emits: ['computer.provisioned'], tool: 'computer', audit: 'sensitive', errors: ['provider.unavailable', 'validation.duplicate'],
    }),
    write('computers.configure', 'Change the tab limit or idle sleep of a computer', {
      in: { ...comp, tabLimit: t.opt(t.int({ minimum: 1, maximum: 50 })), idleSleepMinutes: t.opt(t.int({ minimum: 1, maximum: 1440 })) }, out: { computer: computerRow },
      on: ['computer', '/computerId'], perm: 'computers.use', level: 'manage', team: true, emits: ['computer.configured'], tool: 'computer',
    }),
    write('computers.remove', 'Remove an agent computer and its profile disk', {
      in: comp, out: { removed: t.bool() }, on: ['computer', '/computerId'], perm: 'computers.use', level: 'manage', team: true, emits: ['computer.removed'],
      gate: { act: 'delete', when: "actor.kind != 'person'" }, tool: 'computer', audit: 'always', risk: 'high',
    }),
    write('computers.wake', 'Wake an asleep computer (it sleeps when idle and never mid-task)', {
      in: comp, out: { computer: computerRow }, on: ['computer', '/computerId'], perm: 'computers.use', team: true, emits: ['computer.started'], tool: 'computer', idem: 'natural', offline: 'online',
    }),
    write('computers.sleep', 'Put a computer to sleep; refused while a task is running', {
      in: comp, out: { computer: computerRow }, on: ['computer', '/computerId'], perm: 'computers.use', team: true, emits: ['computer.slept'], tool: 'computer', idem: 'natural', offline: 'online',
      errors: ['validation.precondition_failed'],
    }),
    write('computers.take_over', 'Take over the computer ("You\'re in control"); your actions become one "You took over" step', {
      in: comp, out: { computer: computerRow, ticket: t.str() }, on: ['computer', '/computerId'], perm: 'computers.take_over', level: 'use', team: true, emits: ['computer.takeover', 'computer.started'],
      tool: 'computer', audit: 'sensitive', idem: 'natural', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('computers.give_back', 'Give the computer back to the agent', {
      in: comp, out: { computer: computerRow }, on: ['computer', '/computerId'], perm: 'computers.take_over', level: 'use', team: true, emits: ['computer.given_back', 'computer.recording_saved'], tool: 'computer', idem: 'natural', offline: 'online',
    }),
    write('computers.record_start', 'Record while you take over: every click and key with the element, each page, network traffic with secrets masked, and video', {
      in: comp, out: { recordingId: t.id('rcd') }, on: ['computer', '/computerId'], perm: 'computers.take_over', level: 'use', team: true, emits: ['computer.recording_started'],
      tool: 'computer', audit: 'sensitive', offline: 'online', errors: ['validation.precondition_failed'],
    }),
    write('computers.record_stop', 'Stop recording; the recording is saved in work/recordings/ and one sheet asks what the agent should do with it', {
      in: comp, out: { recording: recordingRow }, on: ['computer', '/computerId'], perm: 'computers.take_over', level: 'use', team: true, emits: ['computer.recording_saved'],
      tool: 'computer', offline: 'online', idem: 'natural',
    }),
    read('computers.screenshot', 'One screenshot of the computer, stored in the agent folder', {
      in: comp, out: { fileId: id.file, width: t.int(), height: t.int(), at: t.ts() }, on: ['computer', '/computerId'], perm: 'computers.watch', team: true, tool: 'computer', label: 'check',
    }),
    read('computers.stream', 'Live view source: WebRTC through the host, or MJPEG over the WebSocket as fallback; frames are live-only, never stored', {
      in: comp, out: { transport: t.enm('webrtc', 'mjpeg'), url: t.str(), ticket: t.str(), expiresAt: t.ts() }, on: ['computer', '/computerId'], perm: 'computers.watch', team: true, tool: 'computer',
    }),
    read('computers.timeline', 'Session timeline: a frame per step with caption (Show This Step, Copy Caption, Make a Skill from Here)', {
      in: { ...comp, runId: t.opt(id.run), threadId: t.opt(id.thread), ...pageIn }, out: { steps: t.arr(stepRow), ...pageOut }, on: ['computer', '/computerId'], perm: 'computers.watch', team: true, tool: 'computer',
    }),
    read('computers.timeline_step', 'One timeline step with its frame', {
      in: { ...comp, stepId: t.id('stp') }, out: { step: stepRow }, on: ['computer', '/computerId'], perm: 'computers.watch', team: true, tool: 'computer',
    }),
    write('computers.skill_from_step', 'Make a skill from this point in a session: starts a turn that writes the skill into the agent folder', {
      in: { ...comp, stepId: t.id('stp'), name: t.opt(t.str()) }, out: { taskId: id.task, runId: t.opt(id.run) }, on: ['computer', '/computerId'], perm: 'computers.use', team: true,
      emits: ['computer.skill_requested'], tool: 'computer', idem: 'key',
    }),
    read('computers.recordings.list', 'Recordings stored in the agent folder', {
      in: { ...comp, ...pageIn }, out: { recordings: t.arr(recordingRow), ...pageOut }, on: ['computer', '/computerId'], perm: 'computers.watch', team: true, tool: 'computer', label: 'filter',
    }),
    read('computers.recording.get', 'Read one recording: events, network log and video paths (follows the folder access)', {
      in: { recordingId: t.id('rcd') }, out: { recording: recordingRow, eventsPath: t.str(), harPath: t.str(), videoPath: t.str() }, perm: 'computers.watch', team: true, tool: 'computer', label: 'check',
    }),
    write('computers.recording.process', 'Say what the agent should do with a recording: make a skill, learn a routine, work out the app backend calls (site recipe note), learn this workflow', {
      in: { recordingId: t.id('rcd'), intents: t.arr(intent, { minItems: 1 }) }, out: { taskId: id.task, runId: t.opt(id.run) }, perm: 'computers.use', team: true,
      emits: ['computer.recording_processed'], tool: 'computer', idem: 'key',
    }),
    write('computers.recording.delete', 'Delete a recording', {
      in: { recordingId: t.id('rcd') }, out: { deleted: t.bool() }, perm: 'computers.use', team: true, tool: 'computer', audit: 'sensitive',
    }),
    read('computers.sessions.list', 'Signed-in browser sessions on the profile disk (listed under Sessions and devices)', {
      in: comp, out: { sessions: t.arr(sessionRow) }, on: ['computer', '/computerId'], perm: 'computers.watch', team: true, tool: 'computer',
    }),
    write('computers.session.sign_out', 'Sign out of a site on the profile disk', {
      in: { ...comp, site: t.str() }, out: { ok: t.bool() }, on: ['computer', '/computerId'], perm: 'computers.take_over', team: true, emits: ['computer.session_signed_out', 'computer.started'], tool: 'computer', audit: 'sensitive',
    }),
    read('computers.health', 'Health of the container runtime and agentd on the host', {
      out: { state: t.enm('healthy', 'degraded', 'down'), detail: t.opt(t.str()), latencyMs: t.opt(t.int()), awake: t.int(), asleep: t.int() }, team: true,
    }),

    // ---- Chrome tools (Vyre for Chrome signed in as the agent)
    read('computers.chrome.snapshot', 'Read the page as an accessibility tree with element refs; prefer this over screenshots', {
      in: { ...optComp, tabId, selector: t.opt(t.str()), format: t.opt(t.enm('tree', 'text')) }, out: { url: t.str(), title: t.str(), tree: t.str(), truncated: t.bool() },
      ...local({ mcpName: 'chrome_snapshot', agent: { planMode: 'allowed' } }),
    }),
    write('computers.chrome.act', 'Act on an element or key: click, hover, press, select, scroll, check; a send, post or payment is held and returns an id', {
      in: { ...optComp, tabId, ref: t.opt(ref), action: t.enm('click', 'double_click', 'hover', 'press', 'select', 'scroll', 'check', 'uncheck', 'focus'), value: t.opt(t.str()) },
      out: { ok: t.bool(), heldId: t.opt(t.str()), snapshot: t.opt(t.str()) }, ...local({ mcpName: 'chrome_act', risk: 'medium', idem: 'none' }),
    }),
    write('computers.chrome.click', 'Click an element by ref or by coordinates', {
      in: { ...optComp, tabId, ref: t.opt(ref), x: t.opt(t.int()), y: t.opt(t.int()), button: t.opt(t.enm('left', 'right', 'middle')) },
      out: { ok: t.bool(), heldId: t.opt(t.str()) }, ...local({ mcpName: 'chrome_click', risk: 'medium', idem: 'none' }),
    }),
    write('computers.chrome.type', 'Type text into the focused element or a ref; secrets only as #Handle.field references', {
      in: { ...optComp, tabId, ref: t.opt(ref), text: t.str(), submit: t.opt(t.bool()) }, out: { ok: t.bool(), heldId: t.opt(t.str()) },
      ...local({ mcpName: 'chrome_type', risk: 'medium', idem: 'none' }),
    }),
    write('computers.chrome.fill', 'Fill form fields; values may be #Handle.field references that the computer vault filler substitutes at the last moment', {
      in: { ...optComp, tabId, fields: t.arr(t.obj({ ref, value: t.str() }), { minItems: 1 }) }, out: { ok: t.bool(), filled: t.int() },
      ...local({ mcpName: 'chrome_fill', risk: 'medium', idem: 'none' }),
    }),
    write('computers.chrome.open', 'Open a URL, reusing the open tab by default (never one tab per step)', {
      in: { ...optComp, url: t.str({ pattern: '^https?://', examples: ['https://example.com'] }), newTab: t.opt(t.bool()) }, out: { tabId: t.str(), url: t.str(), title: t.str() },
      ...local({ mcpName: 'chrome_open', idem: 'none' }),
    }),
    write('computers.chrome.tabs', 'List, use, open or close tabs', {
      in: { ...optComp, action: t.enm('list', 'use', 'new', 'close'), tabId, url: t.opt(t.str()) }, out: { tabs: t.arr(t.obj({ tabId: t.str(), url: t.str(), title: t.str(), active: t.bool() })) },
      ...local({ mcpName: 'chrome_tabs', idem: 'none' }),
    }),
    write('computers.chrome.wait', 'Wait for a load, text, selector, network idle or a time', {
      in: { ...optComp, tabId, until: t.enm('load', 'text', 'selector', 'network_idle', 'time'), value: t.opt(t.str()), timeoutMs: t.opt(t.int({ minimum: 100, maximum: 120000 })) },
      out: { ok: t.bool(), waitedMs: t.int() }, ...local({ mcpName: 'chrome_wait', idem: 'none', risk: 'low' }),
    }),
    read('computers.chrome.screenshot', 'Screenshot of the tab or one element, stored in the agent folder and rendered as a screenshot block', {
      in: { ...optComp, tabId, ref: t.opt(ref), fullPage: t.opt(t.bool()) }, out: { fileId: id.file, width: t.int(), height: t.int() },
      ...local({ mcpName: 'chrome_screenshot', agent: { planMode: 'allowed', blocks: ['screenshot'] } }),
    }),
    write('computers.chrome.eval', 'Run a JavaScript expression in the page and return the result', {
      in: { ...optComp, tabId, expression: t.str() }, out: { result: t.json() }, ...local({ mcpName: 'chrome_eval', risk: 'high', idem: 'none', audit: 'sensitive' }),
    }),
    read('computers.chrome.console', 'Read the page console messages', {
      in: { ...optComp, tabId, level: t.opt(t.enm('log', 'warn', 'error')), limit: t.opt(t.int({ minimum: 1, maximum: 500 })) }, out: { messages: t.arr(t.obj({ level: t.str(), text: t.str(), at: t.ts() })) },
      ...local({ mcpName: 'chrome_console' }),
    }),
    read('computers.chrome.net', 'Read network requests of the tab with timing; bodies are masked by the vault scrubber', {
      in: { ...optComp, tabId, filter: t.opt(t.str()), bodies: t.opt(t.bool()), limit: t.opt(t.int({ minimum: 1, maximum: 500 })) },
      out: { requests: t.arr(t.obj({ method: t.str(), url: t.str(), status: t.opt(t.int()), ms: t.opt(t.int()), body: t.opt(t.str()) })) }, ...local({ mcpName: 'chrome_net' }),
    }),
    read('computers.chrome.inspect', 'Inspect one element: attributes, computed text, box and role', {
      in: { ...optComp, tabId, ref }, out: { element: t.rec() }, ...local({ mcpName: 'chrome_inspect' }),
    }),
    read('computers.chrome.state', 'URL, title and load state of a tab', {
      in: { ...optComp, tabId }, out: { url: t.str(), title: t.str(), loading: t.bool() }, ...local({ mcpName: 'chrome_state' }),
    }),
    read('computers.chrome.status', 'Status of Vyre for Chrome in this computer: connected, paused by Esc, held items', {
      in: { ...optComp }, out: { connected: t.bool(), paused: t.bool(), held: t.arr(t.str()) }, ...local({ mcpName: 'chrome_status' }),
    }),
    write('computers.chrome.stop', 'Stop everything Chrome is doing until the person answers', {
      in: { ...optComp, reason: t.opt(t.str()) }, out: { stopped: t.bool() }, ...local({ mcpName: 'chrome_stop', idem: 'natural', risk: 'low' }),
    }),
    write('computers.chrome.resume', 'Resume after a stop or an Esc press once the person has answered', {
      in: { ...optComp }, out: { resumed: t.bool() }, ...local({ mcpName: 'chrome_resume', idem: 'natural', risk: 'low' }),
    }),
    outward('computers.chrome.send', 'Send a held send, post or payment: the person approves it first (Gate)', {
      in: { ...optComp, heldId: t.str() }, out: { sent: t.bool(), taskId: t.opt(id.task) }, gate: 'send',
      ...local({ mcpName: 'chrome_send', agent: { planMode: 'blocked' } }),
    }),
    write('computers.chrome.batch', 'Run several Chrome steps in one call; stops at the first held item', {
      in: { ...optComp, tabId, steps: t.arr(t.obj({ tool: t.str(), args: t.rec() }), { minItems: 1, maxItems: 50 }) },
      out: { results: t.arr(t.obj({ tool: t.str(), ok: t.bool(), result: t.opt(t.json()), heldId: t.opt(t.str()) })) }, ...local({ mcpName: 'chrome_batch', risk: 'medium', idem: 'none' }),
    }),
    write('computers.chrome.plan', 'Tell the person the steps about to be taken in the browser before taking them', {
      in: { ...optComp, goal: t.str(), steps: t.opt(t.arr(t.str())) }, out: { ok: t.bool() }, ...local({ mcpName: 'chrome_plan', idem: 'none', risk: 'low' }),
    }),
    outward('computers.chrome.api', 'Call a site backend with the session of this browser; non-GET calls pass the Gate', {
      in: { ...optComp, method: t.enm('GET', 'POST', 'PUT', 'PATCH', 'DELETE'), url: t.str({ pattern: '^https?://', examples: ['https://example.com/api/items'] }), headers: t.opt(t.rec(t.str())), body: t.opt(t.json()) },
      out: { status: t.int(), headers: t.rec(t.str()), body: t.json() }, gate: { act: 'post', when: "input.method != 'GET'" },
      ...local({ mcpName: 'chrome_api', agent: { planMode: 'blocked' } }),
    }),
    read('computers.chrome.sources', 'List scripts, requests and storage a page uses (to work out backend calls for a recipe)', {
      in: { ...optComp, tabId }, out: { scripts: t.arr(t.str()), endpoints: t.arr(t.obj({ method: t.str(), url: t.str() })) }, ...local({ mcpName: 'chrome_sources' }),
    }),

    // ---- Screen tools (full desktop on demand)
    read('computers.screen.screenshot', 'Screenshot of the whole desktop', {
      in: { ...optComp }, out: { fileId: id.file, width: t.int(), height: t.int() }, ...local({ mcpName: 'screen_screenshot', agent: { planMode: 'allowed', blocks: ['screenshot'] } }),
    }),
    write('computers.screen.click', 'Click at screen coordinates', {
      in: { ...optComp, x: t.int(), y: t.int(), button: t.opt(t.enm('left', 'right', 'middle')), double: t.opt(t.bool()) }, out: { ok: t.bool() },
      ...local({ mcpName: 'screen_click', risk: 'medium', idem: 'none' }),
    }),
    write('computers.screen.move', 'Move the pointer', {
      in: { ...optComp, x: t.int(), y: t.int() }, out: { ok: t.bool() }, ...local({ mcpName: 'screen_move', idem: 'none', risk: 'low' }),
    }),
    write('computers.screen.drag', 'Drag from one point to another', {
      in: { ...optComp, fromX: t.int(), fromY: t.int(), toX: t.int(), toY: t.int() }, out: { ok: t.bool() }, ...local({ mcpName: 'screen_drag', idem: 'none', risk: 'medium' }),
    }),
    write('computers.screen.type', 'Type text on the desktop; secrets only as #Handle.field references', {
      in: { ...optComp, text: t.str() }, out: { ok: t.bool() }, ...local({ mcpName: 'screen_type', idem: 'none', risk: 'medium' }),
    }),
    write('computers.screen.key', 'Press a key or combination', {
      in: { ...optComp, combo: t.str({ examples: ['ctrl+l'] }) }, out: { ok: t.bool() }, ...local({ mcpName: 'screen_key', idem: 'none', risk: 'medium' }),
    }),
    write('computers.screen.scroll', 'Scroll at a point', {
      in: { ...optComp, x: t.int(), y: t.int(), dx: t.opt(t.int()), dy: t.int() }, out: { ok: t.bool() }, ...local({ mcpName: 'screen_scroll', idem: 'none', risk: 'low' }),
    }),
    write('computers.screen.wait', 'Wait a number of milliseconds', {
      in: { ...optComp, ms: t.int({ minimum: 50, maximum: 60000 }) }, out: { ok: t.bool() }, ...local({ mcpName: 'screen_wait', idem: 'none', risk: 'low' }),
    }),

    // ---- Files tools (the agent Files folder is mounted as ~/Vyre; one copy, no sync)
    read('computers.files.list', 'List a folder of the agent Files folder as seen on the computer', {
      in: { ...optComp, path: t.opt(t.str()) }, out: { entries: t.arr(t.obj({ name: t.str(), kind: t.enm('file', 'folder'), size: t.opt(t.int()), modifiedAt: t.opt(t.ts()) })) },
      ...local({ mcpName: 'computer_files_list' }),
    }),
    read('computers.files.read', 'Read a file from the agent Files folder on the computer', {
      in: { ...optComp, path: t.str(), maxBytes: t.opt(t.int({ minimum: 1, maximum: 5000000 })) }, out: { content: t.str(), encoding: t.enm('utf8', 'base64'), truncated: t.bool() },
      ...local({ mcpName: 'computer_files_read', label: 'check' }),
    }),
    write('computers.files.write', 'Write a file in the agent Files folder (downloads, drafts, work/)', {
      in: { ...optComp, path: t.str(), content: t.str(), encoding: t.opt(t.enm('utf8', 'base64')), mode: t.opt(t.enm('create', 'overwrite', 'append')) }, out: { ok: t.bool(), versionId: t.opt(id.version) },
      ...local({ mcpName: 'computer_files_write', idem: 'none', risk: 'medium' }),
    }),
    write('computers.files.move', 'Move or rename a file in the agent Files folder', {
      in: { ...optComp, from: t.str(), to: t.str() }, out: { ok: t.bool() }, ...local({ mcpName: 'computer_files_move', idem: 'none', risk: 'medium' }),
    }),
    write('computers.files.delete', 'Delete a file from the agent Files folder; always asks outside work/', {
      in: { ...optComp, path: t.str() }, out: { ok: t.bool() }, ...local({ mcpName: 'computer_files_delete', idem: 'none', risk: 'high', gate: { act: 'delete', when: "actor.kind != 'person'" } }),
    }),
  ],
  events: [
    ev('computer.provisioned', 'An agent was given a computer', { p: { computerId: id.computer, agentId: id.agent }, subject: ['computer', '/computerId'] }),
    ev('computer.configured', 'A computer tab limit or idle sleep changed', { p: { computerId: id.computer, fields: t.arr(t.str()) }, subject: ['computer', '/computerId'] }),
    ev('computer.removed', 'An agent computer was removed', { p: { computerId: id.computer, agentId: id.agent }, subject: ['computer', '/computerId'] }),
    ev('computer.started', 'A computer woke', { p: { computerId: id.computer, agentId: id.agent, by: t.str() }, subject: ['computer', '/computerId'] }),
    ev('computer.slept', 'A computer went to sleep', { p: { computerId: id.computer, agentId: id.agent, reason: t.enm('idle', 'requested') }, subject: ['computer', '/computerId'] }),
    ev('computer.takeover', 'A person took over a computer', { p: { computerId: id.computer, agentId: id.agent, personId: id.user }, subject: ['computer', '/computerId'], vis: 'participants' }),
    ev('computer.given_back', 'A person gave a computer back to the agent', { p: { computerId: id.computer, agentId: id.agent, personId: id.user }, subject: ['computer', '/computerId'], vis: 'participants' }),
    ev('computer.recording_started', 'A recording started while a person has the computer', { p: { computerId: id.computer, recordingId: t.id('rcd'), personId: id.user }, subject: ['computer', '/computerId'], vis: 'participants' }),
    ev('computer.recording_saved', 'A recording was saved in the agent folder', { p: { computerId: id.computer, recordingId: t.id('rcd'), durationMs: t.int() }, subject: ['computer', '/computerId'], vis: 'participants' }),
    ev('computer.recording_processed', 'A recording was turned into a skill, routine, recipe or workflow task', {
      p: { recordingId: t.id('rcd'), intents: t.arr(t.str()), taskId: id.task }, subject: ['entity', '/recordingId'], vis: 'participants',
    }),
    ev('computer.skill_requested', 'A skill was requested from a point in a session', { p: { computerId: id.computer, stepId: t.id('stp'), taskId: id.task }, subject: ['computer', '/computerId'], vis: 'participants' }),
    ev('computer.session_signed_out', 'A site session on the profile disk was signed out', { p: { computerId: id.computer, site: t.str(), by: t.str() }, subject: ['computer', '/computerId'], vis: 'participants' }),
  ],
  blocks: [
    block('screenshot', {
      computerId: id.computer, fileId: id.file, caption: t.str(), stepId: t.opt(t.id('stp')), stepIndex: t.opt(t.int()), at: t.ts(),
    }, 'Screenshot: {{caption}}', {
      opens: { tab: 'computer', input: { computerId: '/computerId' } },
      actions: [{ key: 'make_skill', label: 'Make a skill from here', cap: 'computers.skill_from_step', input: { computerId: '/computerId', stepId: '/stepId' } }],
    }),
  ],
  health: [
    health('computers', 'Agent computers', 'computers.health', 'Check that Docker (Colima on a Mac) is running on the host, then restart agentd'),
  ],
  settings: [
    setting('computers.default_tab_limit', 'space', 'Policies', 'Default tab limit for agent computers', t.int({ minimum: 1, maximum: 50 }), 8),
    setting('computers.idle_sleep_minutes', 'space', 'Policies', 'Minutes idle before an agent computer sleeps', t.int({ minimum: 1, maximum: 1440 }), 10),
  ],
  screens: [
    screen('chats.computer-popup', 'chats', 'ui:ComputerPopup', {
      slot: 'sheet',
      q: {
        computer: ['computers.get', { computerId: '/state/computerId' }, true], stream: ['computers.stream', { computerId: '/state/computerId' }, false],
        timeline: ['computers.timeline', { computerId: '/state/computerId', runId: '/state/runId' }, true],
      },
      a: {
        wake: ['computers.wake', { computerId: '/state/computerId' }], sleep: ['computers.sleep', { computerId: '/state/computerId' }],
        takeOver: ['computers.take_over', { computerId: '/state/computerId' }], giveBack: ['computers.give_back', { computerId: '/state/computerId' }],
        recordStart: ['computers.record_start', { computerId: '/state/computerId' }], recordStop: ['computers.record_stop', { computerId: '/state/computerId' }],
        openChat: ['chat.start', {}], skillFromStep: ['computers.skill_from_step', { computerId: '/state/computerId', stepId: '/state/stepId' }],
      },
      empty: 'The computer is asleep', primary: 'Wake', needs: ['computers.watch'],
    }),
    screen('chats.agent-computer', 'chats', 'ui:AgentComputerTab', {
      slot: 'side',
      q: { computer: ['computers.get', { computerId: '/state/computerId' }, true], sessions: ['computers.sessions.list', { computerId: '/state/computerId' }, true] },
      a: { wake: ['computers.wake', { computerId: '/state/computerId' }], provision: ['computers.provision', {}] },
      empty: 'This agent has no computer', primary: 'Give it a computer', needs: ['computers.watch'],
    }),
    screen('chats.recording-sheet', 'chats', 'ui:RecordingSheet', {
      slot: 'sheet',
      q: { recording: ['computers.recording.get', { recordingId: '/state/recordingId' }, true] },
      a: { process: ['computers.recording.process', { recordingId: '/state/recordingId' }], remove: ['computers.recording.delete', { recordingId: '/state/recordingId' }, 'Delete this recording?'] },
      empty: 'No recording', primary: 'Close',
    }),
    screen('console.agent-computers', 'console', 'ui:ConsoleComputers', {
      q: { computers: ['computers.list', { state: '/filter/state' }, true], sessions: ['computers.sessions.list', { computerId: '/state/computerId' }, true] },
      a: {
        sleep: ['computers.sleep', { computerId: '/state/computerId' }], configure: ['computers.configure', { computerId: '/state/computerId' }],
        remove: ['computers.remove', { computerId: '/state/computerId' }, 'Remove this computer and its profile disk?'], signOut: ['computers.session.sign_out', { computerId: '/state/computerId' }],
      },
      empty: 'No agent computers', primary: 'Close', needs: ['console.access'],
    }),
  ],
});
