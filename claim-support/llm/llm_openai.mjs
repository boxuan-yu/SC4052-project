import OpenAI from "openai";

/**
 * OpenAI subsystem (transport layer only)
 */
export class OpenAIWrapper {
  constructor(client, model) {
    this.client = client;
    this.model = model;
  }

  /**
   * Initialise system
   * - pulls API key from env
   * - sets model
   */
  static init() {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("Missing OPENAI_API_KEY in environment.");
    }

    const client = new OpenAI({ apiKey });
    const model = process.env.MODEL ?? "gpt-4o-mini";

    return new OpenAIWrapper(client, model);
  }

  /**
   * Generic chat call
   *
   * Input:
   *   prompt (string)
   *
   * Output:
   *   string
   */
  async send(prompt, options = {}) {
    const res = await this.client.chat.completions.create({
      model: options.model ?? this.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: options.maxTokens ?? 4096,
    });

    return res.choices[0]?.message?.content?.trim() ?? "";
  }

  /**
   * Send prompt and parse JSON array/object safely
   *
   * Handles:
   * - extra text around JSON
   * - +1 bug
   */
  async sendJSON(prompt, options = {}) {
    const raw = await this.send(prompt, options);

    // match either array OR object
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);

    if (!match) {
      throw new Error(`Invalid JSON response:\n${raw}`);
    }

    const cleaned = match[0].replace(/:\s*\+(\d)/g, ": $1");

    return JSON.parse(cleaned);
  }
}