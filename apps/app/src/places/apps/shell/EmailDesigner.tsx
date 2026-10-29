// One email design on its own (spec 3.6; screen apps.email-builder): the same builder Campaigns embeds in a step, opened from Apps, from the Inbox composer's Templates menu and from an Automation email step.
// With an id it opens that design; without one it starts a new design, which is created at its first save and named for its subject. Every edit autosaves as a version, and an Ask Vyre edit comes back
// as a diff to accept change by change. Nothing here draws the builder: CampaignEmail does, here with a stand-in step that carries the design's id and content.
import type { ReactElement } from "react";
import type { CapMap } from "../../../../../../generated/types.ts";
import { CampaignEmail } from "./CampaignEmail.tsx";
import { visibleBlock } from "./email-design.ts";
import { Row } from "../../../../../../ui/src/Row/index.tsx";
import { useAppsData } from "./data.tsx";
import { Card, Frame, useOnline, useRead } from "./editor-ui.tsx";

type Doc = CapMap["email_builder.get"]["out"]["email"];
type Step = Parameters<typeof CampaignEmail>[0]["step"];

/** The stand-in step that hands a design to the builder: its id, subject, mode, blocks and text. */
export function stepOf(doc: Doc | null, id: string | undefined): Step {
  const config: Record<string, unknown> = doc
    ? {
      emailId: doc.emailId, subject: doc.subject ?? "", designMode: doc.mode === "blocks" ? "visual" : doc.mode, html: doc.html ?? "", text: doc.plain ?? "",
      designBlocks: (doc.blocks ?? []).map((block, index) => visibleBlock(block, `blk-${index}`)),
    }
    : {};
  return { key: id ?? "new-design", config } as unknown as Step;
}

export function EmailDesigner({ id, back }: { id?: string | undefined; back(): void }): ReactElement {
  const online = useOnline();
  const doc = useRead<CapMap["email_builder.get"]["out"]>(id ? "email_builder.get" : null, { emailId: id }, "campaigns");
  const loaded = id ? doc.data?.email ?? null : null;
  const d = useAppsData();
  const designs = useRead<CapMap["email_builder.list"]["out"]>(id ? null : "email_builder.list", {}, "campaigns");
  return (
    <Frame testID="apps-email-designer" title={loaded?.name ?? (id ? "Email design" : "New email design")} back={back} offline={!online} error={doc.error} loading={doc.loading && !loaded} retry={doc.refresh}>
      {!id && (designs.data?.emails.length ?? 0) > 0 ? (
        <Card title="Your email designs">
          {designs.data?.emails.map((e) => <Row key={e.emailId} id={`email-design-${e.emailId}`} title={e.name} note={`Updated ${new Date(e.updatedAt).toLocaleDateString()}`} onPress={() => d.nav.openEmailDesign?.(e.emailId)} />)}
        </Card>
      ) : null}
      {id && !loaded ? null : (
        <CampaignEmail
          key={id ?? "new"} step={stepOf(loaded, id)} onChange={() => undefined} title="Email design"
          intro="Email designs save as versions. Use one from Templates in the Inbox composer, in a campaign or in an Automation email step."
        />
      )}
    </Frame>
  );
}
