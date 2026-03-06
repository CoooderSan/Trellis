#!/usr/bin/env node

/**
 * Install SessionStart Hook
 *
 * This script automatically configures the SessionStart hook in ~/.claude/settings.json
 * to inject governance constraints on every Claude Code session start.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function installHook() {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    // Use tilde path for portability across different users
    const hookScriptPath = '~/.claude/skills/agent-governance-bootstrap/hooks/session-start.cjs';

    // Ensure .claude directory exists
    const claudeDir = path.dirname(settingsPath);
    if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Read existing settings
    let settings = {};
    if (fs.existsSync(settingsPath)) {
        try {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch (error) {
            console.error('Failed to parse settings.json:', error.message);
            console.error('Creating backup and starting fresh...');
            fs.copyFileSync(settingsPath, settingsPath + '.backup');
            settings = {};
        }
    }

    // Add hooks configuration (correct format for Claude Code)
    settings.hooks = settings.hooks || {};
    settings.hooks.SessionStart = [
        {
            hooks: [
                {
                    type: 'command',
                    command: `node ${hookScriptPath}`,
                    timeout: 30
                }
            ]
        }
    ];

    // Write updated settings
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        console.log('✅ SessionStart hook installed successfully!');
        console.log('📍 Hook script:', hookScriptPath);
        console.log('📍 Settings file:', settingsPath);
        console.log('\n🔄 Restart Claude Code to activate the hook.');
        console.log('\n📝 The governance constraints will be automatically injected on every session start.');
    } catch (error) {
        console.error('❌ Failed to write settings.json:', error.message);
        process.exit(1);
    }
}

installHook();
