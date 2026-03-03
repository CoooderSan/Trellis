# Intent: 发布改造后的 Trellis 到私有 npm

**创建日期**: 2026-03-04
**创建者**: caocong
**关联文档**: Claude Code 安装与配置指南.md

## 1. 背景与动机

将改造后的 Trellis 框架发布到私有 npm registry，以便团队其他成员可以直接安装使用。当前项目是基于原始 Trellis 的改造版本，需要修改配置并发布到私有仓库。

## 2. 目标

- 将包名从 `@mindfoldhq/trellis` 改为 `@ecochain/trellis`
- 配置发布到私有 npm registry
- 确保团队成员可以正常安装使用
- 验证所有功能正常工作

## 3. 范围

### 包含的功能
- 修改 package.json 配置
- 构建和测试项目
- 发布到私有 npm registry
- 验证安装和使用

### 排除的功能
- 不修改核心业务逻辑
- 不改变现有功能
- 不涉及权限管理变更

## 4. 技术方案

### 4.1 配置修改
- 包名：`@mindfoldhq/trellis` → `@ecochain/trellis`
- 仓库信息更新
- 发布配置调整

### 4.2 构建验证
- 运行 `npm run build`
- 验证 CLI 命令正常工作

### 4.3 发布流程
- 配置私有 npm registry
- 运行 `npm publish`
- 验证发布成功

## 5. 验收标准

- [ ] 包成功发布到私有 npm registry
- [ ] 团队成员可以正常安装使用
- [ ] 所有核心功能正常工作
- [ ] 开发工作流顺畅运行

## 6. 依赖关系

- Node.js >= 18.0.0
- TypeScript 构建环境
- 私有 npm registry 访问权限
- Git 仓库访问权限

## 7. 风险评估

- **低风险**: 配置修改是标准的 npm 包发布流程
- **中风险**: 需要确保私有 registry 配置正确
- **低风险**: 构建过程有现有脚本支持

## 8. 语雀参考文档

- Claude Code 安装与配置指南.md - 包含 npm 相关配置信息

## 9. 备注

需要确认私有 npm registry 的具体配置信息。