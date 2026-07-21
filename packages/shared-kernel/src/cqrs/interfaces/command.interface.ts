export interface CommandOptions {
  /**
   * Wrap the command in a DB transaction. Default: false.
   *
   * Also gates auto-retry: `RetryMiddleware` retries a transient DB error
   * (Postgres deadlock) on any `transactional:true` command automatically — there
   * is deliberately no separate `retryable` opt-in flag (removed 2026-07-14,
   * resilience_patterns.md §3). Retry-on-deadlock is only safe when every side
   * effect rolls back cleanly on the failed attempt, which is exactly what
   * `transactional:true` already guarantees — a second flag repeating that same
   * precondition was redundant, and worse, it made retry-safety an opt-in
   * editorial decision instead of an automatic consequence of being transactional.
   * A prior audit found 12/18 transactional commands had NO deadlock protection
   * simply because nobody had gone back to flip the separate flag on them.
   *
   * A command that is transactional:true but must NOT be blindly retried (e.g. it
   * calls an external service mid-handler, like `ProvisionOrgCommand`'s gRPC call)
   * MUST be `transactional:false` instead and use an app-level saga with explicit
   * compensation — see `ProvisionOrgCommand`'s own comment for the reference case.
   */
  transactional?: boolean
}

export interface ICommand {
  readonly name: string
  readonly options?: CommandOptions
}
