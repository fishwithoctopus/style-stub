# Architecture

## 1. 当前技术方案

MVP 使用无构建步骤的 HTML、CSS 与原生 JavaScript。原因是可以最快验证窄窗交互和视觉方向，也方便直接打开、分享和迭代。

当前结构：

```text
index.html          应用结构
styles.css          票根皮肤、布局、样张和动效
app.js              路由、搜索、Lab、本地存储与 AI 客户端
data/styles.js      公共词库
server/gateway.js   静态页面服务与本地 AI 网关
package.json        本地启动与检查脚本
.env.example        可选的供应商地址配置，不含真实 Key
docs/               产品与工程文档
```

## 2. 数据边界

公共词典和个人数据必须分开：

- 公共词典：版本控制内的只读数据。
- Lab 草稿：浏览器 localStorage。
- 我的风格：浏览器 localStorage。

本地存储键：

```text
style-stub.lab.v1
style-stub.personal.v1
style-stub.catalog.v1
```

## 3. 核心实体

### StyleEntry

```ts
type StyleEntry = {
  id: string
  name: string
  englishName: string
  type: 'system' | 'technique' | 'layout' | 'component' | 'platform'
  era?: string
  summary: string
  accent: string
  tags: string[]
  features: string[]
  elements: string[]
  suitableFor: string[]
  avoid: string[]
  promptZh: string
  promptEn: string
  related: string[]
  preview: string
  conflicts?: string[]
}
```

### LabItem

```ts
type LabItem = {
  entryId: string
  weight: number
}
```

### CatalogConfig

```ts
type CatalogConfig = {
  categories: Array<{ id: string; name: string }>
  customEntries: StyleEntry[]
  entryOrder: string[]
  categoryAssignments: Record<string, string>
}
```

公共词库文件保持只读；用户新增的网页词条、分类调整和展示顺序作为覆盖层保存，升级内置词库时不覆盖个人整理结果。

### PersonalStyle

```ts
type PersonalStyle = {
  id: string
  name: string
  createdAt: string
  items: LabItem[]
  context: string
  mood: string
  mustKeep: string
  avoid: string
  promptZh: string
  promptEn: string
  coverImage?: string
  summary?: string
  analysisResult?: StyleAnalysis
  fidelity?: 'light' | 'balanced' | 'high'
  origin: 'lab' | 'import'
  sourceType?: 'images' | 'manual' | 'figma' | 'skill' // 后两项仅用于兼容旧馆藏
  source?: unknown
  awaitingAI?: boolean
}
```

例图收录时只在浏览器本地生成并保存一张约 300 × 200 的 JPEG 压缩封面，原始图片不写入 `localStorage`。无封面的旧馆藏使用文字占位；Lab 配方使用参与混合的内置 CSS 样张组成封面。个人风格详情负责展示来源、结构化规则和 Prompt，并提供本地编辑与带确认的删除操作。

## 4. UI 状态

应用包含图鉴、公共词条详情、Lab、私人馆藏、个人风格详情与设置等视图。使用原生状态对象切换，不引入前端框架。公共数据保持不可变，用户操作只修改 Lab、个人风格和本地覆盖层。

## 5. 预览策略

MVP 不依赖外部图片。每个词条用一个 `preview` 标识映射到 CSS 组件样张。这样样张可交互、可随窗口缩放，并能直接表达按钮、材质、布局等设计机制。

后续允许为复杂流派加入图像资源字段：

```ts
image?: { src: string; alt: string; attribution?: string }
```

## 6. 桌面化路线

首个 Windows 桌面壳采用 Electron。原因是现有本地 AI 网关已经使用 Node.js，Electron 可以直接把网关嵌入主进程，避免要求用户另开终端或立即重写稳定链路。当前实现包含透明无边框窗口、拖动、置顶、尺寸控制、单实例、系统托盘、贴边吸附、位置记忆与内置动态端口网关；开机启动留待后续。

目标 Windows 窗口使用无系统装饰、透明背景和页面内部纸张阴影。当前网页预览周围的深色舞台不是最终窗口边框。桌面版关闭系统窗口阴影，避免 Windows 11 为无边框窗口附加额外白边或圆角；票根轮廓与阴影完全由界面自身绘制。

置顶由用户在设置中控制，Electron 主进程调用原生窗口的 always-on-top 能力。窗口默认 340 × 720，可切换 320 × 620 紧凑模式或 380 × 820 长票模式。窗口增高用于保证所有实际阅读文字不低于 10px；短屏环境仍会自动限制到可见高度。

桌面主进程把窗口坐标、外框尺寸与左右吸附状态保存到用户应用数据目录；重新启动时会按现有显示器工作区校正，避免拔掉外接屏幕后窗口留在屏幕外。拖动停止后若距离左右边缘不超过 34px，会将透明外框轻微伸出屏幕，让纸张视觉边缘贴近工作区边缘。托盘使用精简 `SS` 圆章；窗口关闭按钮改为隐藏到托盘，真正退出只在托盘菜单执行，以保证后台网关与 Key 状态不会因误关窗口而中断。

## 7. AI 网关

AI 不直接读写公共词库。浏览器把缩放后的例图或用户主动选择整理的文字规则发送给同源本地网关；网关通过 OpenAI 兼容的 Chat Completions 适配千问、DeepSeek 与 Kimi，并把结果归一化为固定 Schema。图片路线采用“千问看图提取 → 千问不看图复审”的两段式；文字录入可直接保存，也可选择交给文本模型整理。Figma 不在应用内重复接入：用户可直接交给 Codex，或导出关键画板后按例图收录。所有 AI 输出在保存前可由用户修改，并保留来源字段。模型分工与密钥安全边界见 `AI_INTEGRATION.md`。

设置页在 localStorage 中只保存非敏感路由：网关地址、视觉/文本提供商、模型 ID 与窗口偏好。浏览器开发版的真实 API Key 只在网关进程内存中；Electron 桌面版通过 `safeStorage` 使用 Windows 用户级加密能力，把密文写入应用数据目录并在启动时恢复。前端只接触“已安全保存/已连接/未连接”状态，永远读不到 Key 原文。
