# Open-source Readiness

## 发布范围

Style Stub 以 GitHub 公共仓库发布源代码、原创词条文本、原创 CSS 样张、应用图标和公开演示截图。个人风格、用户例图、API Key、本地配置和构建产物不进入仓库。

## 许可证

项目已采用 [MIT License](../LICENSE)。第三方名称、商标与平台案例不因此获得授权；它们仅用于识别和设计研究，详见 [NOTICE.md](../NOTICE.md)。未经许可的第三方参考图不随仓库分发。

## 首发检查清单

- [x] README 与本地运行方式
- [x] CONTRIBUTING 贡献规范
- [x] SECURITY 安全说明
- [x] Issue 与 Pull Request 模板
- [x] 忽略本地数据、密钥和构建产物
- [x] MIT License 与 npm 许可元数据
- [x] Windows 免安装构建
- [x] 成品截图
- [x] 项目名：Style Stub / 风格票根
- [x] 推荐仓库名：`style-stub`
- [x] 词条来源与事实核查规则
- [x] 私人路径与常见 Key 形态扫描
- [ ] 确认 GitHub 账号与最终仓库名
- [ ] 创建公共仓库并发布 `v0.5.0`

## 推荐仓库标签

`design-systems`、`ui-design`、`prompt-engineering`、`visual-dictionary`、`electron`、`desktop-app`、`creative-tools`

## 发布方式

- Git 仓库只保存源代码和轻量文档资产。
- Windows 便携版作为 GitHub Release 附件发布。
- Release 版本与 `package.json` 保持一致。
- 每次发布前执行 `npm run check`、`npm test` 和一次桌面烟测。

## 公共词库治理

公共词库通过 Pull Request 维护。新增或修改词条应提供可核验来源，并区分：

- 历史流派与时间范围；
- 官方设计语言；
- 社区惯用标签；
- 带日期的当代产品案例快照。

当代产品案例会随网站更新而过时，因此必须保留快照日期。个人风格默认只存在本机，除非用户主动导出并明确选择分享。
