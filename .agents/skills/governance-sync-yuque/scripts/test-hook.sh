#!/bin/bash

# Test SessionStart Hook
# This script verifies that the hook can successfully read and output governance constraints

echo "🧪 Testing SessionStart Hook..."
echo ""

HOOK_SCRIPT="$(dirname "$0")/../hooks/session-start.cjs"

if [ ! -f "$HOOK_SCRIPT" ]; then
    echo "❌ Hook script not found: $HOOK_SCRIPT"
    exit 1
fi

echo "📍 Hook script location: $HOOK_SCRIPT"
echo ""

echo "🔄 Running hook script..."
echo "---"

node "$HOOK_SCRIPT"

EXIT_CODE=$?

echo "---"
echo ""

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ Hook executed successfully"
    echo ""
    echo "Next steps:"
    echo "1. Run: node scripts/install-hook.js"
    echo "2. Restart Claude Code"
    echo "3. Verify governance constraints are active"
else
    echo "❌ Hook execution failed with exit code: $EXIT_CODE"
    echo ""
    echo "Troubleshooting:"
    echo "1. Check if governance bundle is cached: ls ~/.cache/agent-governance/"
    echo "2. Verify governance-master.md exists"
    echo "3. Check settings.json configuration"
fi
