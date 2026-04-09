import "dotenv/config";
import { analyzeClaim } from "./analyse.mjs";

export default {
  id: "claim-evidence-plugin",
  name: "Claim Evidence",

  register(api) {
    api.registerTool({
      name: "find_claim_evidence",
      description:
        "Extract and rank sentences from text that support a given claim",

      parameters: {
        type: "object",
        properties: {
          claim: { type: "string" },
          text: { type: "string" }
        },
        required: ["claim", "text"]
      },

      async execute(_id, { claim, text }) {
        try {
          console.log("🔥 EXECUTE INPUT:", claim);

          const results = await analyzeClaim(claim, { text });

          console.log("🔥 RAW RESULTS:", results);

          if (!results || results.length === 0) {
            return {
              content: [
                { type: "text", text: "No supporting evidence found." }
              ]
            };
          }

          const top = results.slice(0, 5);

          const formatted = top
            .map(r => `[${r.score.toFixed(3)}] ${r.text}`)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Top supporting evidence:\n\n${formatted}`
              }
            ]
          };

        } catch (e) {
          console.error("❌ TOOL ERROR:", e);

          return {
            content: [
              { type: "text", text: `Error: ${e.message}` }
            ]
          };
        }
      }
    });
  }
};