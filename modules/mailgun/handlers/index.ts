// One handler per mailgun capability: sending, delivery events lookups, domains, routes, health, delivery events and inbound mail (backend.ts).
export {
  domainsCreate, domainsDelete, domainsGet, domainsList, domainsVerify, eventsList, health, parseInbound, parseWebhook, receiveInbound, receiveWebhook, routesCreate, routesDelete,
  routesList, sendEmail,
} from "./backend.ts";
