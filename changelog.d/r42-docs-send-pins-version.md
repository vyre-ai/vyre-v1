A document is never sent for signature in a version the exact-copy check did not see: if a new version is uploaded while a send is under way, the send is refused and nothing goes out.
The send pin now holds a SHA-256 of the file's bytes as well as its version, so a document changed between the check and the send is refused even when the file store names no version.
