#!/bin/bash

# AI Governance & Skills 安装验证脚本
# 用于快速检查 Skills 是否正确安装和配置

echo "=========================================="
echo "  AI Governance & Skills 安装验证"
echo "=========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_pass() {
    echo -e "${GREEN}✅ $1${NC}"
}

check_fail() {
    echo -e "${RED}❌ $1${NC}"
}

check_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# 1. 检查 Skills 目录
echo "1. 检查 Skills 安装..."
if [ -d "$HOME/.claude/skills/agent-governance-bootstrap" ]; then
    check_pass "Skills 目录存在"
    
    # 检查 dist 目录
    if [ -d "$HOME/.claude/skills/agent-governance-bootstrap/dist" ]; then
        check_pass "dist 目录存在（已编译）"
    else
        check_fail "dist 目录不存在（未编译）"
    fi
    
    # 检查 hooks 目录
    if [ -d "$HOME/.claude/skills/agent-governance-bootstrap/hooks" ]; then
        check_pass "hooks 目录存在"
    else
        check_fail "hooks 目录不存在"
    fi
else
    check_fail "Skills 目录不存在"
    echo "   请运行: /plugin install agent-governance-bootstrap"
fi
echo ""

# 2. 检查治理约束缓存
echo "2. 检查治理约束缓存..."
if [ -d "$HOME/.cache/agent-governance" ]; then
    check_pass "治理约束缓存目录存在"
    
    # 检查 prompts 目录
    PROMPTS_DIR=$(find "$HOME/.cache/agent-governance" -type d -name "prompts" 2>/dev/null | head -1)
    if [ -n "$PROMPTS_DIR" ]; then
        check_pass "prompts 目录存在"
        
        # 检查关键文件
        if [ -f "$PROMPTS_DIR/governance-master.md" ]; then
            check_pass "governance-master.md 存在"
            
            # 检查文件大小
            FILE_SIZE=$(wc -c < "$PROMPTS_DIR/governance-master.md")
            if [ "$FILE_SIZE" -gt 1000 ]; then
                check_pass "governance-master.md 内容完整 (${FILE_SIZE} bytes)"
            else
                check_warn "governance-master.md 文件过小，可能不完整"
            fi
        else
            check_fail "governance-master.md 不存在"
        fi
    else
        check_fail "prompts 目录不存在"
    fi
else
    check_warn "治理约束缓存目录不存在（首次运行时会自动创建）"
fi
echo ""

# 3. 检查 settings.json
echo "3. 检查 settings.json 配置..."
if [ -f "$HOME/.claude/settings.json" ]; then
    check_pass "settings.json 存在"
    
    # 检查 hooks 配置
    if grep -q "sessionStart" "$HOME/.claude/settings.json"; then
        check_pass "sessionStart Hook 已配置"
    else
        check_warn "sessionStart Hook 未配置（可能需要手动配置）"
    fi
    
    # 检查 governance 配置
    if grep -q "governance" "$HOME/.claude/settings.json"; then
        check_pass "governance 配置存在"
    else
        check_warn "governance 配置不存在（使用默认配置）"
    fi
else
    check_warn "settings.json 不存在（将使用默认配置）"
fi
echo ""

# 4. 检查语雀缓存
echo "4. 检查语雀文档缓存..."
if [ -d "$HOME/.cache/yuque" ]; then
    DOC_COUNT=$(find "$HOME/.cache/yuque" -type f -name "*.md" 2>/dev/null | wc -l)
    if [ "$DOC_COUNT" -gt 0 ]; then
        check_pass "语雀文档已同步 ($DOC_COUNT 篇)"
    else
        check_warn "语雀文档目录存在但无文档（需要同步）"
    fi
else
    check_warn "语雀缓存目录不存在（需要配置并同步）"
fi
echo ""

# 5. 测试 Hook 脚本
echo "5. 测试 SessionStart Hook..."
HOOK_SCRIPT="$HOME/.claude/skills/agent-governance-bootstrap/hooks/session-start.cjs"
if [ -f "$HOOK_SCRIPT" ]; then
    check_pass "Hook 脚本存在"
    
    # 尝试执行 Hook（限制输出）
    if OUTPUT=$(timeout 5 node "$HOOK_SCRIPT" 2>&1 | head -20); then
        if echo "$OUTPUT" | grep -q "组织级 AI Agent 治理约束"; then
            check_pass "Hook 脚本执行成功（治理约束已加载）"
        else
            check_warn "Hook 脚本执行但未检测到治理约束"
        fi
    else
        check_fail "Hook 脚本执行失败"
    fi
else
    check_fail "Hook 脚本不存在"
fi
echo ""

# 6. 总结
echo "=========================================="
echo "  验证总结"
echo "=========================================="
echo ""
echo "下一步操作："
echo ""
echo "如果所有检查都通过："
echo "  1. 重启 Claude Code"
echo "  2. 在新会话中输入: 请告诉我当前的治理约束是什么？"
echo "  3. 参考 CLAUDE_VERIFICATION_GUIDE.md 进行完整验证"
echo ""
echo "如果有检查失败："
echo "  1. 重新安装 Skills: /plugin install agent-governance-bootstrap"
echo "  2. 检查 settings.json 配置"
echo "  3. 手动注入治理约束: /ecochain_init"
echo ""
echo "详细验证指南："
echo "  cat CLAUDE_VERIFICATION_GUIDE.md"
echo ""
