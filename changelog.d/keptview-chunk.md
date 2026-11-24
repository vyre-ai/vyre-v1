The first list after many records were added (a sync, a start) no longer freezes the server for a second: the rows people may see are worked out and written in slices with a turn for other requests between, and a person who asks in the middle waits for the whole view. A Space of 50,000 records holds the loop for 161 ms at most, down from 1.4 s.

A share, a folder change or any other change to who may see what, made on a view that is stale for a big Space, waits for the view to be built in slices and then makes its change on the whole view; it no longer holds the server while it builds the view itself.

A view that is worked out in slices is thrown away and done again if the access state moved while it was being worked out (a revoke, a role change): nothing older than a revoke is ever kept or served.

A view that is being worked out in slices stops as soon as the access state moves (a writer committed) and tries twice before the one-go build runs, so a long run of writes (a connector export of a big Space) no longer pays for several walks that are thrown away: the export is back to 2.9 to 3.8 s of CPU from 6.7 to 8.1 s.
