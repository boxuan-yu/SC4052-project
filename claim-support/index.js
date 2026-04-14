import path from "node:path";
import fs from "node:fs";
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
          const results = await analyzeClaim(claim, { text });

          const sessionId = crypto.randomUUID();
	  const filePath = path.join(process.cwd(), `claim_${sessionId}.json`);

          if (!results || results.length === 0) {
            return {
              content: [
                { type: "text", text: "No supporting evidence found." }
              ]
            };
          }
	  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
          const preview = results
  		.slice(0, 10)
  		.map(r => `[${r.score.toFixed(3)}] ${r.text}`)
  		.join("\n\n");

	  return {
  	    content: [
    	      {
      		type: "text",
      		text:
        		`Stored ${results.length} ranked segments.\n` +
        		`Session ID: ${sessionId}\n\n` +
        		`Top 10 (most supportive):\n\n${preview}\n\n` +
        		`You can now ask:\n` +
        		`- "next 10"\n` +
        		`- "show bottom 10"\n`
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
api.registerTool({
  name: "query_claim_evidence",
  description: "Query ranked evidence by position",

  parameters: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      mode: { type: "string", enum: ["top", "bottom"] },
      offset: { type: "number" },
      limit: { type: "number" }
    },
    required: ["sessionId"]
  },

  async execute(_id, { sessionId, mode = "top", offset = 0, limit = 10 }) {
    try {
      const filePath = path.join(process.cwd(), `claim_${sessionId}.json`);

      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

      let page;

      if (mode === "bottom") {
        const reversed = [...data].reverse();
        page = reversed.slice(offset, offset + limit);
      } else {
        page = data.slice(offset, offset + limit);
      }

      const formatted = page
        .map(r => `[${r.score.toFixed(3)}] ${r.text}`)
        .join("\n\n");

      const label =
        mode === "bottom"
          ? "Most contradictory segments"
          : "Most supportive segments";

      return {
        content: [
          {
            type: "text",
            text:
              `${label} (${offset}–${offset + page.length}):\n\n` +
              formatted +
              `\n\nNext: ask for offset ${offset + limit}`
          }
        ]
      };

    } catch (e) {
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