/**
 * Detaches stdin after an interactive prompt so the command can simply return.
 *
 * The interactive commands used to end with `process.exit(0)`, which crashes Node on Windows:
 *
 * ```
 * Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
 * ```
 *
 * `process.exit()` tears the event loop down where it stands. `AppModule` still holds an open MPD
 * socket and a Mongoose connection at that moment, and libuv asserts when one of those handles
 * signals the loop after it has already been flagged closing. Success or failure made no difference
 * — the exit was in a `finally`, so the crash landed on top of a perfectly good session file.
 *
 * None of it is needed. `CommandFactory.run` closes the application once a command's `run` resolves,
 * which fires the `onModuleDestroy` hooks that disconnect MPD and Mongo, and the process then exits
 * on its own — that is exactly how every non-interactive command in this CLI already ends.
 *
 * The one thing a prompt adds is stdin. Readline leaves the handle referenced, which would keep the
 * loop alive forever on a console once the command returns, so it is paused and unreferenced here.
 * `unref` is the load-bearing half: `pause` only stops the flow, while `unref` is what stops the
 * handle counting towards keeping the loop open.
 */
export function releaseStdin(): void {
  process.stdin.pause();
  process.stdin.unref();
}
