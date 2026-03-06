#!/usr/bin/env node

/**
 * Install Skills Package to ~/.claude/skills/
 *
 * This script copies the agent-governance-bootstrap package to the Claude Code
 * skills directory, ensuring only the necessary files are installed.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function installSkill() {
    const sourceDir = path.join(__dirname, '..');
    const targetDir = path.join(os.homedir(), '.claude', 'skills', 'agent-governance-bootstrap');

    console.log('📦 Installing agent-governance-bootstrap skill...');
    console.log('📍 Source:', sourceDir);
    console.log('📍 Target:', targetDir);

    // Ensure target directory exists
    const skillsDir = path.dirname(targetDir);
    if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
        console.log('✅ Created skills directory:', skillsDir);
    }

    // Remove existing installation
    if (fs.existsSync(targetDir)) {
        console.log('🗑️  Removing existing installation...');
        fs.rmSync(targetDir, { recursive: true, force: true });
    }

    // Copy the skill package (excluding node_modules, .git, etc.)
    console.log('📋 Copying skill package...');

    try {
        // Use rsync for efficient copying with exclusions
        execSync(`rsync -av --exclude='node_modules' --exclude='.git' --exclude='*.log' --exclude='.DS_Store' "${sourceDir}/" "${targetDir}/"`, {
            stdio: 'inherit'
        });

        console.log('✅ Skill package copied successfully!');
    } catch (error) {
        console.error('❌ Failed to copy skill package:', error.message);
        process.exit(1);
    }

    // Install dependencies in target directory
    console.log('📦 Installing dependencies...');
    try {
        execSync('npm install --production', {
            cwd: targetDir,
            stdio: 'inherit'
        });
        console.log('✅ Dependencies installed successfully!');
    } catch (error) {
        console.error('❌ Failed to install dependencies:', error.message);
        process.exit(1);
    }

    console.log('\n✅ Installation complete!');
    console.log('\n📝 Next steps:');
    console.log('1. Run: node ~/.claude/skills/agent-governance-bootstrap/scripts/install-hook.cjs');
    console.log('2. Restart Claude Code to activate the skill');
}

installSkill();