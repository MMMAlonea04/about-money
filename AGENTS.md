# AGENTS.md

## Graphify

This repo uses **offline Graphify**. The graph lives in `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`).

For questions about code structure, callers, dependencies, or the impact of a change, consult the graph **before grep** or reading files one by one:

- `graphify query "<question>"` — scoped subgraph for how something works
- `graphify path "A" "B"` — shortest path between two concepts
- `graphify explain "<Symbol>"` — one node and its neighbors
- `graphify-out/GRAPH_REPORT.md` — broad architecture context only; skip it for focused questions

Use grep for exact strings, such as error messages or config keys. If `graphify-out/graph.json` does not exist, say so, build it with `graphify extract . --code-only` (or ask for `/graphify .`), then fall back to grep for that turn.

The repo commits its graph: `.githooks/pre-commit` runs `graphify update .` (or `graphify extract . --code-only` on the first commit) and stages `graphify-out/graph.json`, so the graph always matches the committed code. A fresh clone only needs `git config core.hooksPath .githooks`.
