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

// Check if yuque-dl is installed
async function checkYuqueDl() {
    try {
        await execa('which', ['yuque-dl']);
        return true;
    } catch {
        return false;
    }
}

// Install yuque-dl globally
async function installYuqueDl() {
    console.log('📦 yuque-dl 未安装，正在自动安装...');
    try {
        await execa('npm', ['install', '-g', 'yuque-dl'], { stdio: 'inherit' });
        console.log('✅ yuque-dl 安装成功');
        return true;
    } catch (error) {
        console.error('❌ yuque-dl 安装失败:', error.message);
        console.error('请手动安装: npm install -g yuque-dl');
        return false;
    }
}

const config = loadConfig();
const repo = config.yuqueRepo || process.env.YUQUE_REPO;
const token = config.yuqueToken || process.env.YUQUE_TOKEN;
const dir = config.yuqueCacheDir || process.env.YUQUE_CACHE_DIR || `${process.env.HOME}/.cache/yuque`;

if (!repo || !token) {
    console.error('❌ 语雀配置缺失');
    console.error('');
    console.error('请在 ~/.claude/settings.json 中配置：');
    console.error(JSON.stringify({
        governance: {
            yuqueToken: "your-token",
            yuqueRepo: "https://www.yuque.com/org/repo",
            yuqueCacheDir: "~/.cache/yuque"
        }
    }, null, 2));
    console.error('');
    console.error('获取 Token：https://www.yuque.com/settings/tokens');
    process.exit(1);
}

// Check and install yuque-dl if needed
const isInstalled = await checkYuqueDl();
if (!isInstalled) {
    const installed = await installYuqueDl();
    if (!installed) {
        process.exit(1);
    }
}

console.log('🔄 正在同步语雀文档...');
console.log(`   知识库: ${repo}`);
console.log(`   缓存目录: ${dir}`);

try {
    await execa('yuque-dl', [repo, '-t', token, '-d', dir, '--incremental'], { stdio: 'inherit' });
    console.log('');
    console.log('✅ 同步成功');
    console.log(`   文档已缓存到: ${dir}`);
} catch (error) {
    console.error('');
    console.error('❌ 同步失败:', error.message);
    console.error('');
    console.error('可能原因：');
    console.error('- Token 过期或无效');
    console.error('- 网络连接问题');
    console.error('- 知识库 URL 错误');
    console.error('- 权限不足');
    process.exit(1);
}

