# UI Fidelity Notes

## 2026-07-20 · Readable ticket scale

- Baseline viewport changed from 340 × 620 to 340 × 720.
- Compact and long presets are 320 × 620 and 380 × 820.
- All application text used for reading or operation is at least 10px.
- Body, form values, prompts and long explanations use 11–13px.
- Text below 10px is allowed only inside miniature CSS style specimens, where it functions as illustration rather than application copy.
- Catalog tickets increased from 96px to 110px so larger summaries do not overlap or become excessively truncated.
- Short browser viewports still cap the widget to the visible height and retain internal scrolling.

## Verification

- JavaScript syntax check: required after changes.
- Visual check: catalog, detail, Lab, My Styles, AI analysis result and Settings at 320, 340 and 380px widths.
# 2026-07-20 · 设置入口与本机 Key

- 顶部设置入口保留圆形票据印章外框，内部改为单一常规齿轮，去除识别性较弱的 `SET` 缩写。
- 桌面版 Key 状态区明确显示“已安全保存”；浏览器预览明确显示“本次网关内存”，避免对持久化行为产生误解。
- 齿轮按钮继续保持 43px 可点击范围和现有纸质视觉语言。
# 2026-07-20 · 桌面身份与托盘

- 主应用图标复用票根锯齿、暖纸、`SS` 双圈圆章与复古红标记，保持与应用本体同一套视觉语言。
- 托盘图标移除票根文字和边缘细节，只保留高对比圆章，保证 16–24px 下可识别。
- 窗口吸附保留 12px 透明阴影外框的过伸量，使纸张而非透明窗口边界贴近屏幕边缘。
- 关闭按钮仍使用原有 `×` 几何，但语义改为“隐藏到系统托盘”；真正退出位于托盘菜单。
