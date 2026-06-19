import { InfrastructureError } from '../../errors/infra-error.js';

export abstract class CqrsError extends InfrastructureError {
  abstract readonly code: string;
  
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.name = this.constructor.name;
  }
}

export class CommandHandlerNotFoundError extends CqrsError {
  readonly code = 'COMMAND_HANDLER_NOT_FOUND';
  constructor(commandName: string) {
    super(`Command handler not found for command: ${commandName}`, { commandName });
  }
}

export class QueryHandlerNotFoundError extends CqrsError {
  readonly code = 'QUERY_HANDLER_NOT_FOUND';
  constructor(queryName: string) {
    super(`Query handler not found for query: ${queryName}`, { queryName });
  }
}

export class EventHandlerNotFoundError extends CqrsError {
  readonly code = 'EVENT_HANDLER_NOT_FOUND';
  constructor(eventName: string) {
    super(`Event handler not found for event: ${eventName}`, { eventName });
  }
}
