// Capability handlers for events (16): the event log reads and replay entry, and outgoing webhooks. One file holds them all: webhooks.ts.
import {
  eventsGet, eventsList, eventsReplay, eventsSince, eventsTypes, webhooksCreate, webhooksDelete, webhooksDeliveries, webhooksGet, webhooksHealth, webhooksList,
  webhooksReplayDelivery, webhooksRotateSecret, webhooksSendDelivery, webhooksTest, webhooksUpdate,
} from "./webhooks.ts";

export type { EventsCtx } from "../projections.ts";

export const handlers = {
  "events.get": eventsGet,
  "events.list": eventsList,
  "events.replay": eventsReplay,
  "events.since": eventsSince,
  "events.types": eventsTypes,
  "webhooks.create": webhooksCreate,
  "webhooks.delete": webhooksDelete,
  "webhooks.deliveries": webhooksDeliveries,
  "webhooks.get": webhooksGet,
  "webhooks.health": webhooksHealth,
  "webhooks.list": webhooksList,
  "webhooks.replay_delivery": webhooksReplayDelivery,
  "webhooks.rotate_secret": webhooksRotateSecret,
  "webhooks.send_delivery": webhooksSendDelivery,
  "webhooks.test": webhooksTest,
  "webhooks.update": webhooksUpdate,
};
