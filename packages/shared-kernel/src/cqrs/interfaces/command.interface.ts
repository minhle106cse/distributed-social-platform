export interface CommandOptions {
  /** Wrap the command in a DB transaction. Default: false */
  transactional?: boolean;
  /** Retry on transient infrastructure errors. Default: false */
  retryable?: boolean;
}

export interface ICommand {
  readonly name: string;
  readonly options?: CommandOptions;
}

