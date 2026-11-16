-- The connect card's stamp and its take-back (b-connect2, 15 Nov 2026). Both are written only by the card's own save, never by a person naming an item.
-- saved_json: the keys this card saved, as a JSON list of {item, by, hosts}: the item, the person who saved it, and the hosts the connector's actions call. A saved key is offered back on a card only for the same connector, the same person and the same hosts.
ALTER TABLE "vault_requests_requests" ADD COLUMN "saved_json" TEXT;
-- try_item: the key this card saved in the try that is still open, before its connection was made. Only that one item can be taken back, and only from this card; it is cleared when the connection is made or the key is taken back.
ALTER TABLE "vault_requests_requests" ADD COLUMN "try_item" TEXT;
