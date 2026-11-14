// The key request card of a chat (rc.8): an agent that needs a key from the person asks here, where they are. The card says which key and why, takes the value in a secure field that goes straight to the Vault
// (vault.requests.fulfil; the value is in the call, never in a message, a block or a log), or Declines. Once provided the agent carries on in this chat by itself. Needs you keeps a linked row; both close together
// because both read the one request. A person who cannot decide it (a member asking in a Team Space) sees who it is waiting on, never a field.
import { useCallback, useEffect, useState } from "react";
import { useFollow } from "./use-follow.ts";
import type { ReactElement } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Card, CardActions, CardDeny, CardDone, CardField, CardHead } from "../../../../../../ui/src/Card/index.tsx";
import type { ConversationData } from "./data.tsx";
import { Glyph } from "./parts.tsx";
import { Face } from "../needsyou/parts.tsx";
import { AUDIENCES, keyWords, requestOf } from "./keyrequest-model.ts";
import type { KeyAudience, KeyRequest } from "./keyrequest-model.ts";

type Data = Pick<ConversationData, "call" | "changes">;

const NO_FOLDER = "No shared folder is open to this agent yet. Make one, then add the key.";

export function isKeyRequest(type: string): boolean {
  return type === "vault_request";
}

export function KeyRequestCard({
  requestId,
  agent,
  agentId,
  asker,
  nameOf,
  data,
}: {
  requestId: string;
  agent: string;
  agentId: string;
  /** the person the agent asked for (the card's own block says who), and how to say their name */
  asker?: string;
  nameOf?: (id: string) => string;
  data: Data;
}): ReactElement | null {
  const [req, setReq] = useState<KeyRequest | null | undefined>(undefined);
  const [canDecide, setCanDecide] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // who may use the key through the agent (owner ruling, 3 Nov 2026): only the person who asked, unless the approver picks anyone who asks this agent
  const [audience, setAudience] = useState<KeyAudience>("asker");

  const load = useCallback(async (): Promise<void> => {
    try {
      const got = requestOf(await data.call("vault.requests.get", { requestId }));
      const toDecide = (await data.call("vault.requests.list", { mine: false })) as { requests?: { id: string }[] };
      setReq(got);
      setCanDecide((toDecide.requests ?? []).some((r) => r.id === requestId));
    } catch {
      setReq(null);
    }
  }, [data, requestId]);
  useEffect(() => {
    void load();
  }, [load]);
  // the first shared folder the agent can use a key kept in (the access module's own answer, not a list of names): where a key for the team goes. None, and "anyone" is not offered.
  const [shared, setShared] = useState<string | null | undefined>(undefined);
  const waiting = req?.state === "waiting";
  useEffect(() => {
    if (!waiting || !canDecide) return;
    let live = true;
    void (async () => {
      let found: string | null = null;
      try {
        const folders = ((await data.call("vault.folders.list", { scope: "shared" })) as { folders?: { id: string }[] })
          .folders;
        for (const f of folders ?? []) {
          const got = (await data.call("access.clears", {
            principal: { kind: "agent", id: agentId },
            target: { type: "vault_folder", id: f.id },
          })) as { clears?: boolean };
          if (got.clears === true) {
            found = f.id;
            break;
          }
        }
      } catch {
        /* none found: the key stays the asker's own */
      }
      if (live) setShared(found);
    })();
    return () => {
      live = false;
    };
  }, [waiting, canDecide, agentId, data]);
  useFollow(data.changes, load, req === undefined || req === null || req.state === "waiting");

  if (req === undefined || req === null) return null;
  const words = keyWords(req.name);

  if (req.state !== "waiting") {
    const ok = req.state === "fulfilled";
    return (
      <CardDone
        testID={`keyreq-done-${requestId}`}
        ok={ok}
        glyph={<Glyph name={ok ? "check" : "x"} size={13} color={ok ? "var(--ok)" : "var(--ink-3)"} />}
        text={ok ? `Added · ${words}` : req.state === "declined" ? `Declined · ${words}` : `Withdrawn · ${words}`}
      />
    );
  }

  // a team choice needs a folder the agent can use: when there is none, the choice is not offered
  const anyoneOk = !!req.folderId || !!shared;
  // nowhere the agent could use the key: not a shared folder it can use, and not the person's own keys (a manager's Mine is not an option)
  const nowhere = !req.folderId && shared === null && !req.askedYou;
  const choices = AUDIENCES.filter((a) => a.key !== "anyone" || anyoneOk);
  const chosen: KeyAudience = anyoneOk ? audience : "asker";
  const folderFor = async (): Promise<string> => {
    if (req.folderId) return req.folderId;
    if (shared) return shared;
    // a manager answering someone else's ask has no folder of their own the agent can use: never their Mine
    if (!req.askedYou) throw new Error(NO_FOLDER);
    const mine = ((await data.call("vault.folders.list", { scope: "mine" })) as { folders?: { id: string }[] })
      .folders?.[0];
    if (mine) return mine.id;
    return (
      (await data.call("vault.folders.create", {
        name: "Mine",
        scope: "mine",
        idempotencyKey: `kr-${requestId}-folder`,
      })) as { folder: { id: string } }
    ).folder.id;
  };
  // a shared folder made here for the agent's keys: it is not restricted, so the agent can use a key kept in it
  const makeFolder = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      const made = (await data.call("vault.folders.create", {
        name: `${agent} keys`,
        scope: "shared",
        idempotencyKey: `kr-${requestId}-team`,
      })) as { folder: { id: string } };
      setShared(made.folder.id);
    } catch (e) {
      setProblem((e as { message?: string }).message ?? "That folder was not made. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const add = async (): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      const folderId = await folderFor();
      await data.call("vault.requests.fulfil", {
        requestId,
        folderId,
        fields: req.fields.map((k) => ({ key: k, value: (values[k] ?? "").trim() })),
        audience: chosen,
      });
      setValues({});
      await load();
    } catch (e) {
      setProblem((e as { message?: string }).message ?? "That did not save. Try again.");
      void load();
    } finally {
      setBusy(false);
    }
  };
  const decline = async (reason: string): Promise<void> => {
    setBusy(true);
    setProblem("");
    try {
      await data.call("vault.requests.decline", { requestId, ...(reason ? { note: reason } : {}) });
      await load();
    } catch (e) {
      setProblem((e as { message?: string }).message ?? "That did not send. Try again.");
      void load();
    } finally {
      setBusy(false);
    }
  };
  const ready = req.fields.every((k) => (values[k] ?? "").trim() !== "");

  return (
    <Card
      kind="input"
      testID={`keyreq-${requestId}`}
      label={`${agent} needs the ${words}`}
      onCancel={declining ? () => setDeclining(false) : undefined}
      {...(canDecide && !declining && ready && !nowhere && !busy ? { onEnter: () => void add() } : {})}
    >
      <CardHead
        title={`${agent} needs the ${words}`}
        lead={<Face name={agent} seedId={agentId} kind="agent" size={20} />}
      />
      {req.reason ? <Text style={st.reason}>{req.reason}</Text> : null}
      {!canDecide ? (
        <Text testID={`keyreq-wait-${requestId}`} style={st.reason}>
          Asked an admin to add it. It carries on when they do.
        </Text>
      ) : declining ? (
        <CardDeny
          ids={{
            reason: `keyreq-reason-${requestId}`,
            back: `keyreq-back-${requestId}`,
            go: `keyreq-decline-go-${requestId}`,
          }}
          busy={busy}
          onBack={() => setDeclining(false)}
          onDeny={(r) => void decline(r)}
        />
      ) : (
        <View style={st.col}>
          {/* ui-rows-lint: not a list (one secure field per field of the key) */}
          {req.fields.map((k, i) => (
            <CardField
              key={k}
              label={req.fields.length === 1 ? "Key" : k}
              accessLabel={req.fields.length === 1 ? `${words} value` : `${words}, ${k}`}
              testID={`keyreq-field-${requestId}-${k}`}
              value={values[k] ?? ""}
              onChange={(v) => setValues({ ...values, [k]: v })}
              placeholder={req.fields.length === 1 ? "Paste the key" : k}
              secure
              hint={i === 0 ? "It goes straight to the Vault. No message holds it." : " "}
              error={null}
              disabled={busy}
            />
          ))}
          {choices.length > 1 ? (
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={`Who can use it through ${agent}`}
              testID={`keyreq-audience-${requestId}`}
              style={st.col}
            >
              <Text style={st.ask}>{`Who can use it through ${agent}?`}</Text>
              {/* ui-rows-lint: not a list (the two choices of one question) */}
              {choices.map((a) => (
                <Pressable
                  key={a.key}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: chosen === a.key }}
                  aria-checked={chosen === a.key}
                  accessibilityLabel={a.label}
                  testID={`keyreq-audience-${a.key}-${requestId}`}
                  onPress={() => setAudience(a.key)}
                  style={st.choice}
                >
                  <View style={[st.dot, chosen === a.key && st.dotOn]} />
                  <Text style={st.choiceText}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            // one way to share is a fact, not a choice: say it
            <Text testID={`keyreq-audience-${requestId}`} style={st.reason}>
              {`Only ${
                req.askedYou ? "you" : asker && nameOf ? nameOf(asker) : "the person it is for"
              } can use it through ${agent}`}
            </Text>
          )}
          {nowhere ? (
            <Text testID={`keyreq-nowhere-${requestId}`} style={st.reason}>
              {NO_FOLDER}
            </Text>
          ) : null}
          <CardActions
            busy={busy}
            secondary={[
              ...(nowhere
                ? [
                    {
                      label: "Make a shared folder",
                      onPress: () => void makeFolder(),
                      testID: `keyreq-makefolder-${requestId}`,
                    },
                  ]
                : []),
              { label: "Deny", onPress: () => setDeclining(true), testID: `keyreq-decline-${requestId}` },
            ]}
            primary={{
              label: "Add the key",
              disabled: !ready || nowhere,
              onPress: () => void add(),
              testID: `keyreq-add-${requestId}`,
            }}
          />
          {nowhere ? (
            <Text testID={`keyreq-whocan-${requestId}`} style={st.reason}>
              Every agent in this Space can use keys kept in a shared folder.
            </Text>
          ) : null}
        </View>
      )}
      {problem ? (
        <Text accessibilityRole="alert" style={st.err}>
          {problem}
        </Text>
      ) : null}
    </Card>
  );
}

const st = StyleSheet.create({
  reason: { fontSize: 13, lineHeight: 18, color: "var(--ink-2)" as string },
  col: { gap: 8 },
  err: { fontSize: 12.5, color: "var(--danger)" as string },
  ask: { fontSize: 13, color: "var(--ink-2)" as string },
  choice: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 28 },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: "var(--ink-3)" as string },
  dotOn: { borderWidth: 4.5, borderColor: "var(--accent)" as string },
  choiceText: { fontSize: 13, color: "var(--ink)" as string },
});
