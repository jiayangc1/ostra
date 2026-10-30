import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { JsonRequest, LLMProvider, TextRequest, Tier } from "./llm.ts";

export interface AnthropicProviderOptions {
  apiKey?: string;
  /** Small, fast model for categorization and labeling. */
  fastModel?: string;
  /** Stronger model for drafting and rewriting. */
  smartModel?: string;
}

/** Claude via the official SDK. Haiku sorts and labels; Opus writes. */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly models: Record<Tier, string>;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.models = { fast: opts.fastModel ?? "claude-haiku-5-5", smart: opts.smartModel ?? "claude-opus-5-5" };
  }

  async json<T>(req: JsonRequest<T>): Promise<T> {
    const response = await this.client.messages.parse({
      model: this.models[req.tier],
      max_tokens: req.maxTokens ?? 1024,
      // Classification doesn't repay deep thinking; keep it quick and cheap.
      output_config: { effort: "low", format: zodOutputFormat(req.schema as never) },
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.prompt }],
    });
    if (response.stop_reason === "refusal") throw new Error("model declined");
    if (response.parsed_output == null) throw new Error("model returned unparseable output");
    return response.parsed_output as T;
  }

  async *stream(req: TextRequest): AsyncIterable<string> {
    const stream = this.client.messages.stream(
      {
        model: this.models[req.tier],
        max_tokens: req.maxTokens ?? 4096,
        output_config: { effort: "low" },
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: req.prompt }],
      },
      { signal: req.signal },
    );
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new Error("model declined");
  }
}
