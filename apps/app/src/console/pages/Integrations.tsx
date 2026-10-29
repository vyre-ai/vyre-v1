import type {ReactElement} from "react";
import {ConnectorsPage} from "./Connectors.tsx";
import {ConnectionsPage} from "./Connections.tsx";
export function IntegrationsPage({mode}:{mode:"connectors"|"connections"}):ReactElement{return mode==="connectors"?<ConnectorsPage/>:<ConnectionsPage/>;}
export {ConnectorsPage,ConnectionsPage};
export {WebhooksPage} from "./Webhooks.tsx";
export {ApiKeysPage} from "./ApiKeys.tsx";
