// Stand-in for @anthropic-ai/sdk in tests: messages.stream() replies from a
// script the test sets, so the real chat route runs end to end without the API.

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type Params = { messages: { role: string; content: unknown }[]; tool_choice?: { type: string }; system?: unknown; tools?: unknown };

/** The test's model: what it replies to each request. */
export const script: { reply: (p: Params) => Block[] } = { reply: () => [{ type: "text", text: "" }] };
export const calls: Params[] = [];

let ids = 0;
export function toolUse(name: string, input: Record<string, unknown>): Block {
  return { type: "tool_use", id: `toolu_${++ids}`, name, input };
}

class Stream {
  private blocks: Block[];
  constructor(blocks: Block[]) {
    this.blocks = blocks;
  }
  async *[Symbol.asyncIterator]() {
    for (const b of this.blocks) {
      if (b.type !== "text") continue;
      // In small pieces, like the real stream.
      for (let i = 0; i < b.text.length; i += 7) yield { type: "content_block_delta", delta: { type: "text_delta", text: b.text.slice(i, i + 7) } };
    }
  }
  async finalMessage() {
    return { role: "assistant", content: this.blocks };
  }
}

export default class Anthropic {
  messages = {
    stream: (p: Params) => {
      calls.push(p);
      return new Stream(script.reply(p));
    },
  };
}
