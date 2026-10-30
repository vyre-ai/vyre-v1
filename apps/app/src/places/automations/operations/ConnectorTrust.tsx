// The connectors a person may plug in, with how far each is trusted.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { useAutomationsData } from "../canvas/data.tsx";
import { CONNECT_LIMIT, connectorLine, shownConnectors } from "../connect/trust-view.ts";
import type { ConnectorSource, ShownConnector } from "../connect/trust-view.ts";
import { v } from "./parts.tsx";

export function ConnectorTrust(): ReactElement {
  const data = useAutomationsData();
  const [rows, setRows] = useState<ShownConnector[] | "loading" | "unavailable">("loading");
  useEffect(() => {
    let live = true;
    void data.call("connectors.list", { limit: 50 }).then((out) => {
      if (!live) return;
      const list = out && typeof out === "object" && Array.isArray((out as { connectors?: unknown }).connectors)
        ? (out as { connectors: ConnectorSource[] }).connectors
        : [];
      setRows(shownConnectors(list, "author"));
    }).catch(() => { if (live) setRows("unavailable"); });
    return () => { live = false; };
  }, [data]);
  if (rows === "loading") return null;
  if (rows === "unavailable") return <Text style={v.dim}>The connector list did not load for this sign-in. Ask a Space admin if you need to see it.</Text>;
  return (
    <View>
      <Text style={v.dim}>{CONNECT_LIMIT}</Text>
      {/* ui-rows-lint: not a list (one connector sentence) */}
      {rows.map((row) => <Text key={row.key} style={v.row}>{connectorLine(row)}</Text>)}
    </View>
  );
}
