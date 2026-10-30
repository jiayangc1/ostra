/**
 * Glue between the API and @ostra/ai. Filled in with the AI milestone; until
 * then new mail stays `primary` with `ai_pending` set so it is categorized
 * once the pipeline is available.
 */
export interface AiService {
  readonly available: boolean;
  /** Categorize + auto-label freshly ingested messages. Never throws for model failures. */
  processMessages(userId: string, messageIds: string[]): Promise<void>;
  /** Re-run categorization for threads whose earlier attempt failed. */
  retryThreads?(userId: string, threadIds: string[]): Promise<void>;
}

export const noopAi: AiService = {
  available: false,
  async processMessages() {},
};
