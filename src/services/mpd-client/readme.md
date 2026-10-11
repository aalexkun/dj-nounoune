### Documentation Located at

https://mpd.readthedocs.io/en/latest/protocol.html

### How the client frames the protocol

- One TCP socket, one command on the wire at a time. Requests queue in a FIFO and each is written
  only once the previous reply has been read in full.
- A fresh connection opens with the banner `OK MPD <version>`. Nothing may be sent before it, and a
  first line that is not a banner means the port is not an MPD server: the connection is dropped.
- A text reply ends at a line that is exactly `OK`, or is a single `ACK [<code>@<index>] {<command>}
  <message>` line. The check is anchored on the line break before the `OK`, because a tag value can
  end in those letters (`Title: It's OK`) and a chunk boundary can fall right after it.
- `albumart` and `readpicture` answer with raw bytes that may contain `OK\n`; their length comes
  from the `binary:` header instead. See `binary-response.util.ts`.

### How it recovers

- Every request carries a deadline, `MPD_TIMEOUT_MS` (default 2000), counted from the moment it is
  queued. A request that expires while on the wire fails and the connection is dropped, since its
  reply could still arrive and be taken for the next command's. A request that expires while still
  queued simply fails.
- A dropped connection, whether the socket closed or a deadline forced it, fails only the request
  that was on the wire. Queued requests were never sent and wait for the next connection under
  their own deadlines.
- A reconnect is scheduled at once, on a backoff from 500 ms to 5 s, when a request is waiting. An
  idle client reconnects on its next request instead, so a connection MPD closed for inactivity
  (`connection_timeout`, 60 s by default) is not reopened only to go idle again.
- Each connection is a new socket with its listeners registered once; a socket that has been
  replaced is ignored even if it still emits `close` on the way out.
- Without `MPD_HOST`, `send` rejects at once instead of queueing a request nothing will ever serve.
- The service is provided by `MpdClientModule` alone. Listing it in another module's `providers`
  as well creates a second instance with its own idle connection to the daemon.
