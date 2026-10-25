// join/Checklist: the first-run checklist in the join pattern (spec 3.13, 2.1, ARCH 7.0). Five steps from home.checklist; each row has its own action,
// done rows say Done, and the assistant waits behind the AI account. Hidden once all are done or dismissed ("All set").
import { AppIcon, Bar, Button, Group, JoinFrame, Panel, Row, Step, Title } from "./kit.tsx";
import type { JoinMode } from "./palette.ts";

export type ChecklistKey = "photo_and_title" | "connect_mailbox_and_calendar" | "meet_assistant" | "open_first_project" | "import";
export interface ChecklistItem { key: ChecklistKey; title: string; done: boolean }

const WORDS: Record<ChecklistKey, { sub: (space: string) => string; action: string }> = {
  photo_and_title: { sub: (space) => `Next to your name in ${space}`, action: "Add" },
  connect_mailbox_and_calendar: { sub: () => "So agents can draft and schedule for you", action: "Connect" },
  meet_assistant: { sub: () => "Say hello in a chat", action: "Open" },
  open_first_project: { sub: () => "Start with the one you were invited to", action: "Open" },
  import: { sub: () => "Mail, drives, CRM or spreadsheets", action: "Import" },
};

export interface ChecklistProps {
  space: string;
  items: ChecklistItem[];
  /** false once dismissed or finished */
  visible: boolean;
  /** the assistant is locked until an AI account is connected */
  assistantLocked?: boolean;
  onGo?: (key: ChecklistKey) => void;
  onDismiss?: () => void;
  mode?: JoinMode;
}

export function Checklist({ space, items, visible, assistantLocked, onGo, onDismiss, mode }: ChecklistProps) {
  const done = items.filter((i) => i.done).length;
  const finished = !visible || (items.length > 0 && done === items.length);
  const bar = <Bar hideBack cont={<Button testID="checklist-done" label={finished ? "Done" : "Not now"} onPress={onDismiss} />} />;
  return (
    <JoinFrame {...(mode ? { mode } : {})}>
    <Panel center bar={bar}>
      <Step id="checklist">
        <AppIcon kind="space" letter={space} />
        <Title title={finished ? "All set" : "Get started"} sub={finished ? `${space} is ready.` : `${done} of ${items.length} done`} />
        {finished ? null : (
          <Group testID="checklist">
            {items.map((it) => {
              const blocked = it.key === "meet_assistant" && !!assistantLocked && !it.done;
              return (
                <Row
                  kind="check" key={it.key} testID={`check-${it.key}`} title={it.title} done={it.done}
                  sub={it.done ? "Done" : blocked ? "Connect an AI account first" : WORDS[it.key].sub(space)}
                  {...(blocked ? { aside: "Locked" } : {})}
                  {...(it.done || blocked ? {} : { action: { label: WORDS[it.key].action, testID: `go-${it.key}`, onPress: () => onGo?.(it.key) } })}
                />
              );
            })}
          </Group>
        )}
      </Step>
    </Panel>
    </JoinFrame>
  );
}

