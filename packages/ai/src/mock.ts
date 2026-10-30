import type { JsonRequest, LLMProvider, TextRequest } from "./llm.ts";

/** Deterministic provider for tests: a handler decides each answer; every call is recorded. */
export class MockLLM implements LLMProvider {
  readonly name = "mock";
  readonly calls: { kind: "json" | "stream"; tier: string; system: string; prompt: string }[] = [];

  constructor(
    private readonly handlers: {
      json?: (req: JsonRequest<unknown>) => unknown;
      text?: (req: TextRequest) => string;
    } = {},
  ) {}

  async json<T>(req: JsonRequest<T>): Promise<T> {
    this.calls.push({ kind: "json", tier: req.tier, system: req.system, prompt: req.prompt });
    if (!this.handlers.json) throw new Error("mock: no json handler");
    return req.schema.parse(this.handlers.json(req as JsonRequest<unknown>));
  }

  async *stream(req: TextRequest): AsyncIterable<string> {
    this.calls.push({ kind: "stream", tier: req.tier, system: req.system, prompt: req.prompt });
    if (!this.handlers.text) throw new Error("mock: no text handler");
    const text = this.handlers.text(req);
    for (const word of text.split(/(?<= )/)) yield word;
  }
}
