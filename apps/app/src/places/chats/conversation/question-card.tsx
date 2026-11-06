// An agent's open question in the transcript, as a card from the one card library (owner, 6 Nov 2026): a decision card, borderless on the card fill with the 12 px radius, the question as its title and the answers
// as its actions (the first the primary, the rest quiet). The same question also docks above the composer in a long session (QuestionIsland); answering either one answers both.
import type { ReactElement } from "react";
import { Card, CardActions, CardHead } from "../../../../../../ui/src/Card/index.tsx";
import type { QuestionOption } from "./model.ts";

export function QuestionCard({ id, prompt, options, onAnswer }: { id: string; prompt: string; options: readonly QuestionOption[]; onAnswer: (optionId: string) => void }): ReactElement {
  const [first, ...rest] = options;
  return (
    <Card kind="decision" size="compact" testID={`question-card-${id}`} label={prompt}>
      <CardHead title={prompt} />
      <CardActions
        {...(first ? { primary: { label: first.label, testID: `option-${id}-${first.id}`, onPress: () => onAnswer(first.id) } } : {})}
        secondary={rest.map((o) => ({ label: o.label, testID: `option-${id}-${o.id}`, onPress: () => onAnswer(o.id) }))}
      />
    </Card>
  );
}
