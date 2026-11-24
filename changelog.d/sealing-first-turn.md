Keeping sealed values that waited for the Vault gives the server's loop a turn before it starts and every 5 ms of work (the first stretch was 36 ms on an idle server, more on a busy one).
