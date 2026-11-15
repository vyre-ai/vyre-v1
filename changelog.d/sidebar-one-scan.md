### Fixed

- The Chats sidebar's first page reads a person's chats once instead of three times. At 5,000 chats and 200 channels the read took 36 ms and now takes 20 ms on the same computer, so it stays under its 100 ms limit on a busy one. The rules for what is listed did not change.
