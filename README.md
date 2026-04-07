# Claim Support Analyzer

Ranks sentences in a document by how much they support (or contradict) a given claim, using an OpenAI model. Built as an OpenClaw plugin for SC4052.

## How it works

1. The document text is split into individual sentences and consecutive sentence pairs.
2. All segments are sent to an OpenAI model in one batch request, each rated from -2 (strongly contradicts) to +2 (strongly supports).
3. Results are printed sorted from greatest support to greatest disagreement.

## Setup

### 1. Navigate to the plugin directory

```powershell
cd extensions/claim-support
```

### 2. Create your `.env` file

```powershell
copy .env.example .env
```

Open `.env` and fill in your details:

```
OPENAI_API_KEY=sk-your-actual-key-here
MODEL=gpt-4o-mini
```

### 3. Install dependencies

```powershell
npm install
```

## Usage

### Inline text

```powershell
node analyze.mjs "your claim" "your document text"

Example:
node analyze.mjs "Remote work generally improves employee productivity." "A six-month internal review at Northstar Analytics found that software engineers completed 12 pemore tasks per week after moving to a hybrid remote model. Emported having longer uninterrupted focus periods at home and fewer time-consuming office interruptions. However, several managers said onboarding new hires became slower because junior staff had fewer opportunities for spontaneous questions. The review also noted that some teams experienced delays in cross-functional decision-making when discussions moved to chat instead of happening face to face. In a follow-up employee survey, 68 percent of respondents said they personally felt more productive working remotely at least three days a week. At the same time, 21 percent said they struggled with isolation and found it harder to stay motivated without a separate workspace. The report concluded that remote work can improve productivity for many employees, but the effects depend on job type, home environment, and team communication practices."
```

### From a file

```powershell
node analyze.mjs "your claim" --file path/to/document.txt
```

### Options

| Flag            | Description                                                 |
| --------------- | ----------------------------------------------------------- |
| `--file <path>` | Read document text from a file instead of passing it inline |
| `--no-pairs`    | Only analyse individual sentences, skip consecutive pairs   |
| `--top <n>`     | Show only the top N segments                                |
| `--key <key>`   | Pass the OpenAI API key directly instead of using `.env`    |

## Example

```powershell
node analyze.mjs "Remote work improves productivity." "Studies show a 12 percent increase in output. Some employees reported difficulty collaborating. Overall satisfaction scores rose significantly."
```

Output:

```
Claim: "Remote work improves productivity."
Analysing 3 sentences → 5 segments…

────────────────────────────────────────────────────────────
▲▲  STRONGLY SUPPORTS
   [sentence 3]
   "Overall satisfaction scores rose significantly."
    → Rising satisfaction is closely linked to productivity gains.

 ▲  SUPPORTS
   [sentence 1]
   "Studies show a 12 percent increase in output."
    → Directly states a measurable productivity improvement.

 ·  NEUTRAL
   [sentences 1+2]
   "Studies show a 12 percent increase in output. Some employees reported difficulty collaborating."
    → Mixed evidence weakens the overall support.

 ▼  CONTRADICTS
   [sentence 2]
   "Some employees reported difficulty collaborating."
    → Collaboration difficulty can reduce team productivity.
```
