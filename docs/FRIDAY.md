# FRIDAY

## What "trained" means here

FRIDAY's intent resolution has three layers, tried in order:

1. **Groq / Gemini** (if API keys are configured) — an LLM given the tool catalog and a handful of
   few-shot examples drawn from `friday/trainingData.ts`, asked to return `{tool, parameters}` as JSON.
2. **On-device classifier** (`friday/classifier.ts`) — TF-IDF (unigram + bigram, stemmed) vectors with
   cosine-similarity k-NN over ~150 labelled example utterances (`friday/trainingData.ts`). This is the
   literal "trained model": deterministic, offline, no network call, no external weights. Adding
   examples to `trainingData.ts` **is** how FRIDAY is trained further — there is no hidden fine-tuning
   step and none is claimed.
3. **Deterministic regex fallbacks** for a handful of legacy intents (traffic status, fleet listing).

`friday/classifier.ts:extractSlots` then pulls parameters (road code, vehicle id, percent, weather
condition, algorithm names in the order mentioned, event type) out of the raw text with rules — this is
explicit pattern matching, not learned.

`tests/friday.test.ts` requires ≥ 85% accuracy on a **held-out** paraphrase set (different wording from
the training examples) before the suite passes, and separately verifies every training example is
itself recovered correctly.

## Grounded replies

Tools in `friday/twinTools.ts` (the digital twin, analysis, benchmark, learning, demo and algorithm
explainer tools) build their reply text directly from the data they just computed and set
`grounded: true`. When a tool is grounded, `fridayController.ts` uses that exact text instead of asking
an LLM to summarize the tool result — so what FRIDAY says can never drift from what the tool actually
returned.

## Write tools require confirmation

`twin.apply_event` (and the pre-existing incident-creation tools) mutate live state and are listed in
`TWIN_WRITE_TOOLS`; the chat controller asks the user to confirm before executing them. `twin.what_if`
looks similar but runs on a clone and needs no confirmation — the reply text says "SIMULATED" and "the
live twin is unchanged" explicitly so this distinction is never ambiguous to the user.
