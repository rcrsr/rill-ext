#!/usr/bin/env bash
# Creates or updates the rill-ext label taxonomy (the label axes only).
# Types (Bug/Feature/Chore/Security/Idea) and Priority are native org-level
# GitHub fields, not labels, and are configured in org settings, not here.
#
# One signal per axis; label text is the load-bearing distinction (WCAG 1.4.1).
# area:* uniform blue; on-hold gray (parked); needs-triage yellow (pending).
# Each area maps to a capability domain in the extension monorepo; see
# .github/labeler.yml for the glob map and the full taxonomy doc.
#
# Usage: .github/scripts/sync-labels.sh            (defaults to rcrsr/rill-ext)
#        REPO=owner/name .github/scripts/sync-labels.sh
#
# Idempotent: `gh label create --force` upserts, so re-running only updates
# color/description drift. Requires: gh, authenticated with repo scope.
set -euo pipefail

REPO="${REPO:-rcrsr/rill-ext}"

AREA_COLOR="1d76db"   # blue, uniform across every area
HOLD_COLOR="d2dae1"   # gray, parked/inactive
TRIAGE_COLOR="fbca04" # yellow, pending/triage

declare -a AREAS=(
  "area:llm|LLM providers (Anthropic, Gemini, OpenAI, Foundry) and shared/ext-llm"
  "area:vectordb|vector DBs (Chroma, Pinecone, Qdrant) and shared/ext-vector"
  "area:kv|key-value stores (Redis, SQLite, file) and shared/ext-kv"
  "area:fs|filesystems (local, S3) and shared/ext-fs"
  "area:search|web search (Brave, Exa, SearXNG, Serper, Tavily) and shared/ext-search"
  "area:mcp|the Model Context Protocol client extension"
  "area:prompt|prompt/content processing: prompt-md, text, shared/ext-prompt"
  "area:integrations|third-party integrations: Outlook, Google Workspace, Claude Code"
  "area:utils|native-primitive extensions: crypto, exec, fetch, datetime"
  "area:shared|cross-cutting foundations: shared/ext-param (p.* helpers)"
  "area:docs|documentation content: per-package docs, README, CHANGELOG"
  "area:dx|CI, toolchain, lint/format rules, root workspace config"
)

for entry in "${AREAS[@]}"; do
  name="${entry%%|*}"
  desc="${entry#*|}"
  gh label create "$name" --repo "$REPO" --color "$AREA_COLOR" --description "$desc" --force
done

gh label create "on-hold" --repo "$REPO" --color "$HOLD_COLOR" \
  --description "Shaped work deliberately parked; not low priority, not blocked-by a specific issue" --force

gh label create "needs-triage" --repo "$REPO" --color "$TRIAGE_COLOR" \
  --description "Enforcer-managed: missing an area label or an Issue Type. Never hand-apply." --force

echo "Label taxonomy synced to $REPO."
