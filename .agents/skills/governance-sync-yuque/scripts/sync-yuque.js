#!/usr/bin/env node
import { execa } from 'execa';
import fs from 'fs';
import path from 'path';

// Load configuration from settings.json
function loadConfig() {
    try {
        const settingsPath = path.join(process.env.HOME || '', '.claude', 'settings.json');
        if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
            return settings.governance || {};
        }
    } catch (error) {
        console.warn('[sync-yuque] Failed to load settings.json:', error.message);
    }
    return {};
}

const config = loadConfig();
const repo = config.yuqueRepo || process.env.YUQUE_REPO;
const token = config.yuqueToken || process.env.YUQUE_TOKEN;
const dir = config.yuqueCacheDir || process.env.YUQUE_CACHE_DIR || `${process.env.HOME}/.cache/yuque`;

if(!repo||!token){
    console.error('Missing YUQUE_REPO or YUQUE_TOKEN');
    console.error('Please configure in ~/.claude/settings.json or set environment variables');
    process.exit(1);
}

console.log('Syncing Yuque...');
await execa('yuque-dl',[repo, '-t', token, '-d', dir, '--incremental'],{stdio:'inherit'});
console.log('Synced Yuque');
