# Style Stub v0.5.0 — 首个公开桌面版

Style Stub / 风格票根是一款放在 Windows 桌面侧边使用的视觉风格图鉴与 Prompt 实验室。

## 这一版包含

- 35 张内置视觉风格票根与原创 CSS 小样
- 中文、英文、别名和视觉关键词模糊搜索
- 可展开的定义、视觉规则、避坑项与完整中英文 UI Prompt
- 最多 4 种风格的 Lab 配方与自动百分比换算
- 个人风格馆藏、封面、详情、编辑与删除
- 1–4 张例图的可迁移视觉规则提取
- Windows 透明票根窗口、置顶、贴边、位置记忆与系统托盘
- Windows 用户级加密 API Key 存储

## 下载

下载 `Style-Stub-0.5.0-Windows.exe`，双击即可运行，无需安装。

Windows 可能会因为该便携版尚未进行代码签名而显示 SmartScreen 提示。请只从本项目的 GitHub Releases 下载，并自行核对文件来源。本版本不会绕过或关闭系统安全检查。

## AI 说明

AI 功能完全可选。默认图片路线为“千问看图提取 → 千问不看图复审”，用于减少来源产品文案、Tab、图标含义和信息架构被写入最终 Prompt。使用第三方模型前，请阅读对应提供商的隐私与数据处理条款。

## 校验

- `npm run check`
- `npm test`
- Windows 便携版桌面烟测

完整变更见 [CHANGELOG.md](../CHANGELOG.md)。
