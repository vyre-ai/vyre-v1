// Resolve an incoming record link once, then mount the existing record or project page.
import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { attemptKey } from "./files-review.ts";
import { States } from "../../../../../ui/src/States/index.tsx";
import { RecordPage, RecordPageDataProvider } from "../../places/records/recordpage/index.ts";
import type { RecordPageData } from "../../places/records/recordpage/index.ts";
import type { TabKey } from "../../places/records/projectpage/model.ts";
import { ProjectPage } from "../../places/records/projectpage/ProjectPage.tsx";
import { ProjectPageDataProvider } from "../../places/records/projectpage/data.tsx";
import type { ProjectPageData } from "../../places/records/projectpage/data.tsx";
import { capLive, nameLookup } from "./records-live.ts";
import type { ShellRuntime } from "./runtime.tsx";

export async function resolveRecordType(call: ShellRuntime["call"], recordId: string, hint?: string): Promise<string> {
  if (hint) { await call("records.get", { type: hint, recordId }); return hint; }
  const out = await call("schema.types.list", {}) as { types: Array<{ key: string }> };
  for (const type of out.types) {
    try { await call("records.get", { type: type.key, recordId }); return type.key; }
    catch (e) {
      const code = (e as { code?: string; error?: { code?: string } }).code ?? (e as { error?: { code?: string } }).error?.code;
      if (!code || !/not_found|forbidden|denied/.test(code)) throw e;
    }
  }
  throw new Error("That record is unavailable or you do not have access.");
}

export function RecordDetail({ rt, recordId, type: hint, fields = false, tab = "overview" }: { rt: ShellRuntime; recordId: string; type?: string; fields?: boolean; tab?: TabKey }): ReactElement {
  const [resolved, setResolved] = useState<{ type?: string; recordId?: string; projectId?: string; error?: string }>({});
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    let alive = true;
    setResolved({});
    void (async () => {
      if (recordId.startsWith("prj_")) {
        const out = await rt.call("projects.get", { projectId: recordId }) as { project: { type: string; recordId: string } };
        return { type: out.project.type, recordId: out.project.recordId, projectId: recordId };
      }
      const type = await resolveRecordType(rt.call, recordId, hint);
      {
        let cursor: string | undefined;
        do {
          const out = await rt.call("projects.list", { type, ...(cursor ? { cursor } : {}) }) as { projects: Array<{ projectId: string; recordId: string }>; next?: string };
          const project = out.projects.find((p) => p.recordId === recordId);
          if (project) return { type, recordId, projectId: project.projectId };
          cursor = out.next;
        } while (cursor);
      }
      return { type, recordId };
    })().then((target) => { if (alive) setResolved(target); }, () => { if (alive) setResolved({ error: "That record is unavailable or you do not have access." }); });
    return () => { alive = false; };
  }, [rt, recordId, hint]);
  const data = useMemo<RecordPageData>(() => ({
    live: (cap, input) => capLive(rt, cap, input as Record<string, unknown>), call: rt.call, nameOf: nameLookup(rt), now: () => rt.clock().now,
    nav: {
      openRecord: (type, id) => rt.open({ subject: { type: "record", id }, args: { type } }),
      openChat: (type, id, ask) => { void rt.call("chat.start", { kind: "ask", idempotencyKey: attemptKey(), agentIds: [rt.assistant.id], scopeType: type, scopeId: id, ...(ask ? { first: ask } : {}) }).then((out: unknown) => { rt.open({ subject: { type: "thread", id: (out as { thread: { threadId: string } }).thread.threadId } }); }).catch(() => setActionError("Couldn’t open the record’s chat. Try again.")); },
      openFiles: (type, id) => { void rt.call("records.get", { type, recordId: id }).then((out: unknown) => {
        const folder = (out as { record: { fields: Record<string, unknown> } }).record.fields.folder;
        if (typeof folder !== "string" || !folder) throw new Error("No folder");
        rt.open({ subject: { type: "folder", id: folder } });
      }).catch(() => setActionError("This record has no folder you can open.")); },
      openSource: (link) => rt.openUrl(link),
    },
  }), [rt]);
  const projectData = useMemo<ProjectPageData>(() => ({ call: rt.call, nameOf: nameLookup(rt), now: () => rt.clock().now, nav: {
    openChannel: (id) => rt.open({ subject: { type: "channel", id } }), openThread: (id) => rt.open({ subject: { type: "thread", id } }),
    openFolder: (id) => rt.open({ subject: { type: "folder", id } }), openFile: (id) => rt.open({ subject: { type: "file", id } }),
    openRecord: (type, id) => rt.open({ subject: { type: "record", id }, args: { type } }),
    openRecordPage: (type, id) => rt.open({ subject: { type: "record", id }, args: { type, recordView: "fields" } }),
  } }), [rt]);
  if (actionError) return <States kind="error" message={actionError} retryable onRetry={() => setActionError("")} />;
  if (resolved.error) return <States kind="error" message={resolved.error} />;
  if (!resolved.type) return <States kind="empty" title="Opening record…" icon="records" />;
  return !fields && resolved.projectId !== undefined
    ? <ProjectPageDataProvider value={projectData}><ProjectPage key={recordId} projectId={resolved.projectId!} tab={tab} onTabChange={(next) => rt.open({ subject: { type: "project", id: resolved.projectId! }, args: { tab: next } })} /></ProjectPageDataProvider>
    : <RecordPageDataProvider value={data}><RecordPage key={`${resolved.type}:${recordId}`} type={resolved.type} recordId={resolved.recordId ?? recordId} /></RecordPageDataProvider>;
}
