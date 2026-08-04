/**
 * A command is now pure intent — nothing about persistence lives here.
 *
 * `CommandOptions.transactional` was removed in ADR-0001: a flag on the DTO could
 * drift from the handler that actually does the writing. Whether a transaction is
 * opened, and whether the command is retried, is inferred from the handler's type
 * (`ITransactionalCommandHandler` vs `ISagaCommandHandler`).
 */
export interface ICommand {
  readonly name: string
}
