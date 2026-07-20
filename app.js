const entries = window.STYLE_ENTRIES || [];
const view = document.querySelector('#view');
const searchWrap = document.querySelector('#searchWrap');
const searchInput = document.querySelector('#searchInput');
const clearSearch = document.querySelector('#clearSearch');
const navLabCount = document.querySelector('#navLabCount');
const toast = document.querySelector('#toast');
const desktopBridge = window.styleStubDesktop;

if (desktopBridge?.isDesktop) document.documentElement.classList.add('desktop-shell');

const storage = {
  lab: 'style-stub.lab.v1',
  personal: 'style-stub.personal.v1',
  settings: 'style-stub.settings.v1',
  catalog: 'style-stub.catalog.v1'
};

const safeLoad = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; }
  catch { return fallback; }
};

const defaultCategories = [
  { id: 'system', name: '风格体系' },
  { id: 'case-study', name: '当代产品案例' },
  { id: 'platform', name: '时代与平台' },
  { id: 'layout', name: '布局系统' },
  { id: 'technique', name: '材质与技法' },
  { id: 'component', name: '组件' }
];

const state = {
  route: 'catalog',
  selectedId: null,
  personalEditingId: null,
  query: '',
  activeCategory: 'all',
  categoriesExpanded: false,
  lab: safeLoad(storage.lab, []),
  personal: safeLoad(storage.personal, []),
  catalog: safeLoad(storage.catalog, { categories: defaultCategories, customEntries: [], entryOrder: [], categoryAssignments: {} }),
  settings: safeLoad(storage.settings, {
    gatewayUrl: 'http://127.0.0.1:47820/v1',
    visionProvider: 'qwen',
    visionModel: 'qwen3.7-plus',
    textProvider: 'qwen',
    textModel: 'qwen3.7-plus',
    windowWidth: 340,
    windowHeight: 720,
    alwaysOnTop: true
  }),
  context: '桌面端小工具',
  mood: '克制、触感、具有收藏感',
  mustKeep: '',
  avoid: '通用 SaaS 卡片墙、紫蓝科技渐变'
};

const desktopGatewayPort = Number(new URLSearchParams(location.search).get('gatewayPort'));
if (desktopBridge?.isDesktop && Number.isInteger(desktopGatewayPort) && desktopGatewayPort > 0 && desktopGatewayPort < 65536) {
  state.settings.gatewayUrl = `http://127.0.0.1:${desktopGatewayPort}/v1`;
}

if (state.settings.readableTypeVersion !== 1) {
  state.settings.windowHeight = Math.max(720, Number(state.settings.windowHeight) || 720);
  state.settings.readableTypeVersion = 1;
  localStorage.setItem(storage.settings, JSON.stringify(state.settings));
}

if (state.settings.aiReviewRouteVersion !== 1) {
  state.settings.textProvider = 'qwen';
  state.settings.textModel = 'qwen3.7-plus';
  state.settings.aiReviewRouteVersion = 1;
  localStorage.setItem(storage.settings, JSON.stringify(state.settings));
}

if (state.settings.uiCleanupVersion !== 1) {
  if (!['qwen', 'kimi'].includes(state.settings.visionProvider)) {
    state.settings.visionProvider = 'qwen';
    state.settings.visionModel = 'qwen3.7-plus';
  }
  if (!['qwen', 'deepseek', 'kimi'].includes(state.settings.textProvider)) {
    state.settings.textProvider = 'qwen';
    state.settings.textModel = 'qwen3.7-plus';
  }
  state.settings.uiCleanupVersion = 1;
  localStorage.setItem(storage.settings, JSON.stringify(state.settings));
}

state.catalog.categories ||= [];
defaultCategories.forEach(category => {
  if (!state.catalog.categories.some(item => item.id === category.id)) state.catalog.categories.push(category);
});
const legacyInboxCategory = state.catalog.categories.find(category => category.id === 'ai-inbox');
if (legacyInboxCategory?.name === '待 AI 整理') {
  legacyInboxCategory.name = '待整理';
  persistCatalog();
}
if (state.catalog.categoryOrderVersion !== 2) {
  const defaultIds = defaultCategories.map(category => category.id);
  state.catalog.categories.sort((a, b) => {
    const ai = defaultIds.indexOf(a.id); const bi = defaultIds.indexOf(b.id);
    if (ai < 0 && bi < 0) return 0;
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  });
  state.catalog.categoryOrderVersion = 2;
  persistCatalog();
}
state.catalog.customEntries ||= [];
state.catalog.entryOrder ||= [];
state.catalog.categoryAssignments ||= {};
state.catalog.customEntries.forEach(entry => { if (!entries.some(item => item.id === entry.id)) entries.push(entry); });

const personalDraft = {
  sourceType: 'images',
  files: [],
  coverImage: '',
  coverPromise: null,
  analysisResult: null,
  lastAnalysisPayload: null,
  fidelity: 'balanced'
};

const fidelityPresets = {
  light: {
    zh: '轻度借鉴',
    en: 'Light influence',
    zhRule: '只借鉴核心气质、色彩关系与字体倾向。页面结构、组件造型、布局节奏、图标系统和装饰资产都以新产品需求为主，不复用来源产品的具体内容。',
    enRule: 'Borrow only the core mood, color relationships, and typographic tendency. Let the new product brief determine structure, component geometry, layout rhythm, icon system, and decorative assets.'
  },
  balanced: {
    zh: '平衡迁移',
    en: 'Balanced transfer',
    zhRule: '保留核心气质、色彩关系、字体层级、边缘与材质策略、空间密度和图标绘制语法；页面结构与业务内容必须根据新产品重新建立。',
    enRule: 'Preserve the mood, color relationships, type hierarchy, edge and material strategy, spatial density, and icon grammar while rebuilding page structure and product content from the new brief.'
  },
  high: {
    zh: '高度保真',
    en: 'High fidelity',
    zhRule: '尽可能忠实保留可迁移的视觉系统，包括色彩比例、字体对比、空间节奏、容器几何、层级、图标画法与装饰语法；仍不得复用品牌资产、原文案、具体图标含义、Tab 数量或业务架构。',
    enRule: 'Closely preserve the transferable visual system, including color proportions, type contrast, spatial rhythm, container geometry, hierarchy, icon drawing style, and decorative grammar. Never reuse brand assets, source copy, icon meanings, tab count, or source information architecture.'
  }
};

const providerDefaultModels = {
  qwen: 'qwen3.7-plus',
  deepseek: 'deepseek-v4-flash',
  kimi: 'kimi-k3'
};

function detectedModelOwner(model = '') {
  if (/^qwen/i.test(model)) return 'qwen';
  if (/^deepseek/i.test(model)) return 'deepseek';
  if (/^(kimi|moonshot)/i.test(model)) return 'kimi';
  return '';
}

const savedVisionOwner = detectedModelOwner(state.settings.visionModel);
const savedTextOwner = detectedModelOwner(state.settings.textModel);
if (savedVisionOwner && savedVisionOwner !== state.settings.visionProvider) state.settings.visionModel = providerDefaultModels[state.settings.visionProvider] || state.settings.visionModel;
if (savedTextOwner && savedTextOwner !== state.settings.textProvider) state.settings.textModel = providerDefaultModels[state.settings.textProvider] || state.settings.textModel;
localStorage.setItem(storage.settings, JSON.stringify(state.settings));

function fidelityMarker(language) {
  return language === 'zh' ? '\n\n---\n【风格应用档位】' : '\n\n---\n[STYLE APPLICATION PRESET]';
}

function stripFidelityPrompt(value, language) {
  return String(value || '').split(fidelityMarker(language))[0].trim();
}

function buildFidelityPrompt(basePrompt, level = 'balanced', language = 'zh') {
  const base = stripFidelityPrompt(basePrompt, language);
  if (!base) return '';
  const preset = fidelityPresets[level] || fidelityPresets.balanced;
  const suffix = language === 'zh' ? `${preset.zh}\n${preset.zhRule}` : `${preset.en}\n${preset.enRule}`;
  return `${base}${fidelityMarker(language)}${suffix}`;
}

function renderFidelitySwitch(selected, context, styleId = '') {
  return `<div class="fidelity-switch" aria-label="风格应用档位">${Object.entries(fidelityPresets).map(([level, preset]) => `<button type="button" class="${selected === level ? 'active' : ''}" data-${context}-fidelity="${level}"${styleId ? ` data-style-id="${escapeHtml(styleId)}"` : ''}>${preset.zh}</button>`).join('')}</div>`;
}

let gatewayHealth = null;
let lastGatewayResult = null;

const catalogDrag = { timer: null, active: false, card: null, wrapper: null, pointerId: null, startX: 0, startY: 0, lastY: 0, dropTarget: null, dropAfter: false, suppressClick: false };

const typeNames = { system: '风格体系', technique: '材质与技法', layout: '布局系统', component: '组件', platform: '时代与平台', 'case-study': '当代产品案例' };

const searchAliases = {
  skeuomorphism: ['拟物化', '真实材质', 'early ios'],
  ios7: ['苹果扁平', '半透明苹果', 'flat ios'],
  'liquid-glass': ['液体玻璃', '苹果玻璃', 'apple glass'],
  glassmorphism: ['毛玻璃', '磨砂玻璃', 'frosted glass'],
  neumorphism: ['软界面', 'soft ui', '新拟物'],
  'neo-brutalism': ['粗野主义', 'brutalism', '硬阴影'],
  editorial: ['杂志风', '画册', '编辑设计'],
  'bento-grid': ['便当盒', '卡片网格', 'bento'],
  y2k: ['千禧风', '镀铬', '数字未来主义'],
  'pixel-ui': ['像素风', '复古游戏', 'pixel'],
  'paper-texture': ['纸感', '热敏纸', '纸张'],
  'ticket-stub': ['票根', '电影票', '门票']
};

function persistCatalog() {
  localStorage.setItem(storage.catalog, JSON.stringify(state.catalog));
}

function entryCategory(entry) {
  return state.catalog.categoryAssignments[entry.id] || entry.type;
}

function categoryName(id) {
  return state.catalog.categories.find(category => category.id === id)?.name || typeNames[id] || id;
}

const catalogCategoryRank = { system: 0, 'case-study': 1, platform: 2, layout: 3, technique: 4, component: 5 };

function defaultCatalogOrder() {
  return [...entries].sort((a, b) => {
    const rankA = catalogCategoryRank[entryCategory(a)] ?? 6;
    const rankB = catalogCategoryRank[entryCategory(b)] ?? 6;
    return rankA - rankB || entries.indexOf(a) - entries.indexOf(b);
  }).map(entry => entry.id);
}

if (state.catalog.orderVersion !== 3) {
  state.catalog.entryOrder = defaultCatalogOrder();
  state.catalog.orderVersion = 3;
  persistCatalog();
}

function orderedCatalogEntries() {
  const order = state.catalog.entryOrder;
  return [...entries].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai < 0 && bi < 0) return entries.indexOf(a) - entries.indexOf(b);
    if (ai < 0) return 1;
    if (bi < 0) return -1;
    return ai - bi;
  });
}

function normalizeSearch(value = '') {
  return value.toLowerCase().normalize('NFKC').replace(/[\s\-_/·,，。:：()（）]+/g, '');
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = old;
    }
  }
  return row[b.length];
}

function fuzzyMatch(entry, query) {
  if (!query) return true;
  const aliases = [...(searchAliases[entry.id] || []), ...(entry.aliases || [])];
  const fields = [entry.name, entry.englishName, entry.summary, ...(entry.tags || []), ...aliases].filter(Boolean);
  const normalizedQuery = normalizeSearch(query);
  if (fields.some(field => normalizeSearch(field).includes(normalizedQuery))) return true;
  const queryTokens = query.toLowerCase().split(/[\s,，/]+/).filter(Boolean);
  const fieldTokens = fields.flatMap(field => field.toLowerCase().split(/[\s\-_/·,，。:：()（）]+/).filter(Boolean));
  return queryTokens.every(token => fieldTokens.some(fieldToken => {
    if (fieldToken.includes(token) || token.includes(fieldToken)) return true;
    const limit = Math.max(token.length, fieldToken.length) >= 8 ? 2 : 1;
    return /^[a-z0-9]+$/i.test(token + fieldToken) && editDistance(token, fieldToken) <= limit;
  }));
}

function specimen(name) {
  const content = {
    skeuo: '<button>PRESS</button>',
    ios7: '<div class="frost">TRANSLUCENT</div>',
    liquid: '<button>Continue</button>',
    glass: '<div class="glass-card">GLASS / 24</div>',
    neumorph: '<button>●</button>',
    brutal: '<button>CLICK!</button>',
    editorial: '<b>FORM<br>& TYPE</b><i></i><small>ISSUE 07<br>VISUAL CULTURE</small>',
    bento: '<i></i><i></i><i></i>',
    y2k: '<b>FUTURE_2000</b>',
    pixel: '<b>START ▶</b>',
    paper: '', ticket: '',
    aqua: '<button>OK</button><i></i>',
    metal: '<b>STUDIO</b><i></i>',
    bigsur: '<i></i><i></i><i></i>',
    bauhaus: '<b>A</b><i></i><i></i><i></i>',
    swiss: '<b>GRID</b><i></i><small>01 — SYSTEM</small>',
    minimal: '<b>Less.</b><i></i>',
    artdeco: '<b>DECO</b><i></i>',
    memphis: '<b>M</b><i></i><i></i><i></i>',
    midcentury: '<b>MODERN</b><i></i><i></i>',
    construct: '<b>ДА!</b><i></i><small>1923</small>',
    maximal: '<b>MORE!</b><i></i><i></i>',
    aero: '<b>hello!</b><i></i>',
    vercel: '<b>▲ SHIP</b><i></i><small>01 / 04</small>',
    kimi: '<b>K3</b><i></i><small>Ask anything</small>',
    claude: '<b>Claude</b><i></i><small>How can I help?</small>',
    chatgpt: '<b>ChatGPT</b><i></i><small>Message</small>',
    figma: '<b>FIGMA</b><i></i><i></i><i></i>',
    hellenic: '<b>Ω</b><i></i><small>ΜΕΑΝΔΡΟΣ</small>',
    neoclassical: '<b>Ι II Ι</b><i></i><small>ORDER</small>',
    byzantine: '<b>✦</b><i></i><i></i>',
    gothic: '<b>A</b><i></i><small>folio vii</small>',
    baroque: '<b>B</b><i></i><i></i>',
    rococo: '<b>R</b><i></i><i></i>'
  };
  return `<div class="specimen ${name}-spec">${content[name] || ''}</div>`;
}

function escapeHtml(value = '') {
  return value.replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function showToast(message, duration = 3000) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), duration);
}

function persistLab() {
  localStorage.setItem(storage.lab, JSON.stringify(state.lab));
  updateCounts();
}

function updateCounts() {
  navLabCount.textContent = state.lab.length ? `·${state.lab.length}` : '';
}

function setRoute(route, id = null) {
  state.route = route;
  state.selectedId = id;
  if (route !== 'mineDetail') state.personalEditingId = null;
  document.querySelectorAll('.tab-bar button').forEach(button => button.classList.toggle('active', button.dataset.route === route || ((route === 'detail' || route === 'catalogManage') && button.dataset.route === 'catalog') || (route === 'mineDetail' && button.dataset.route === 'mine')));
  searchWrap.hidden = route !== 'catalog';
  view.scrollTop = 0;
  render();
}

function renderCatalog() {
  const q = state.query.trim().toLowerCase();
  const filtered = orderedCatalogEntries().filter(entry => (state.activeCategory === 'all' || entryCategory(entry) === state.activeCategory) && fuzzyMatch(entry, q));
  view.innerHTML = `
    <div class="section-kicker catalog-heading"><span>${q ? 'SEARCH RESULT / 搜索结果' : 'ISSUE 001 / 馆藏目录'}</span><span><strong>${String(filtered.length).padStart(2, '0')} TICKETS</strong><button id="manageCatalog">＋ 收录</button></span></div>
    <div class="category-control"><div class="category-strip ${state.categoriesExpanded ? 'expanded' : ''}"><button data-category="all" class="${state.activeCategory === 'all' ? 'active' : ''}">全部</button>${state.catalog.categories.map(category => `<button data-category="${category.id}" class="${state.activeCategory === category.id ? 'active' : ''}">${escapeHtml(category.name)}</button>`).join('')}</div><button class="category-icon" id="toggleCategories" aria-label="${state.categoriesExpanded ? '收起分类' : '展开分类'}">${state.categoriesExpanded ? '⌃' : '⌄'}</button><button class="category-icon add" id="openCategoryModal" aria-label="新增分类">＋</button></div>
    <div class="reorder-hint">HOLD & DRAG / 长按拖动 · 键盘 Shift＋↑↓</div>
    ${filtered.length ? `<div class="catalog-list" id="catalogList">${filtered.map(entry => `
      <div class="mini-ticket-shadow">
        <article class="mini-ticket" role="button" tabindex="0" data-entry="${entry.id}" style="--accent:${entry.accent}">
          <div class="mini-preview">${specimen(entry.preview)}</div>
          <div class="mini-info"><small>${categoryName(entryCategory(entry))} · ${entry.era}</small><h2>${entry.name}</h2><p>${entry.summary}</p></div>
          <span class="ticket-code">NO.${String(entries.indexOf(entry) + 1).padStart(3, '0')}</span>
        </article>
      </div>`).join('')}</div>` : `<div class="empty-state"><div class="empty-icon">⌕</div><h2>没有找到这张票</h2><p>换一个风格名、组件或视觉关键词试试。</p></div>`}
    <div class="modal-backdrop" id="categoryModal" hidden><form class="paper-modal" id="categoryForm"><button type="button" class="modal-close" id="closeCategoryModal">×</button><small>NEW CATEGORY / 新分类</small><h2>给新抽屉命名</h2><label class="field-label required-field">分类名称 <b>必填</b><input id="modalCategoryName" autocomplete="off" placeholder="例如：个人流派"></label><button class="ink-button" type="submit">新增分类</button></form></div>
  `;
  view.querySelectorAll('[data-entry]').forEach(card => {
    card.addEventListener('click', () => { if (!catalogDrag.suppressClick) setRoute('detail', card.dataset.entry); });
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter') setRoute('detail', card.dataset.entry);
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        moveCatalogEntryWithKeyboard(card.dataset.entry, event.key === 'ArrowUp' ? 'up' : 'down');
      }
    });
  });
  view.querySelectorAll('[data-category]').forEach(button => button.addEventListener('click', () => { state.activeCategory = button.dataset.category; renderCatalog(); }));
  document.querySelector('#manageCatalog').addEventListener('click', () => setRoute('catalogManage'));
  document.querySelector('#toggleCategories').addEventListener('click', () => { state.categoriesExpanded = !state.categoriesExpanded; renderCatalog(); });
  document.querySelector('#openCategoryModal').addEventListener('click', () => { document.querySelector('#categoryModal').hidden = false; document.querySelector('#modalCategoryName').focus(); });
  document.querySelector('#closeCategoryModal').addEventListener('click', closeCategoryModal);
  document.querySelector('#categoryModal').addEventListener('click', event => { if (event.target.id === 'categoryModal') closeCategoryModal(); });
  document.querySelector('#categoryForm').addEventListener('submit', event => { event.preventDefault(); addCatalogCategoryFromModal(); });
  bindCatalogLongPress();
}

function typographyGuidance(entry) {
  const byId = {
    'swiss-style': 'Use a disciplined neo-grotesk sans-serif family with a compact scale and optional monospace metadata. Favor left alignment, clear baselines and decisive size contrast.',
    bauhaus: 'Use a geometric sans-serif display face with a highly readable neutral sans-serif for body copy. Keep type functional; use rotation or circular placement only for short labels.',
    minimalism: 'Use one refined sans-serif or a restrained serif/sans pairing, no more than two families and four weights. Let size, line height and whitespace create hierarchy.',
    editorial: 'Pair an expressive editorial serif display face with a neutral sans-serif for body and metadata. Use dramatic scale contrast while keeping long-form reading comfortable.',
    'art-deco': 'Use a tall geometric display face for short headings and a quiet, readable sans-serif for body copy. Reserve decorative letterforms for titles only.',
    'vercel-geist': 'Use a crisp modern sans-serif for interface copy and a matching monospace for code, labels and status metadata.',
    'claude-current': 'Use a warm editorial display face sparingly, paired with a humanist sans-serif optimized for long-form reading.',
    'figma-brand': 'Use an expressive grotesk display face with a highly legible sans-serif UI face; vary scale confidently while keeping controls compact.',
    'pixel-ui': 'Use bitmap or pixel lettering only for short display labels; use a clean system sans-serif for paragraphs and essential controls.'
  };
  if (byId[entry.id]) return byId[entry.id];
  if (entry.type === 'platform' && (entry.tags || []).includes('Apple')) return 'Use a neutral system sans-serif inspired by Apple interface typography, with clear optical sizes, restrained weights and compact metadata. Do not rely on ultra-thin text.';
  return 'Use at most two font families: one display face that supports the chosen visual language and one highly readable UI/body face. Define display, heading, body, label and metadata roles with consistent line height and weight.';
}

function buildCompletePrompt(entry) {
  const features = (entry.features || []).join(', ');
  const elements = (entry.elements || []).join(', ');
  const avoid = (entry.avoid || []).join('; ');
  const suitable = (entry.suitableFor || []).join(', ');
  return `Create a polished, high-fidelity responsive UI reference in the ${entry.englishName} visual language.

PROJECT GOAL
Design [PRODUCT OR PAGE TYPE] for [TARGET USER]. The primary user task is [PRIMARY ACTION]. If a separate product brief is provided, preserve its information architecture and real content. The style should support the product rather than turn the page into a decorative poster.

OVERALL DIRECTION
${entry.promptEn}
Core character: ${entry.summary}
Best suited to: ${suitable}.

PAGE CONTENT AND STRUCTURE
- A compact global header with identity, essential navigation and one clear primary action.
- A focused hero or primary task area that immediately explains what the product does.
- Two to four meaningful content sections derived from the product brief; do not invent generic statistics, testimonials or pricing cards unless the product needs them.
- A representative component area showing the real states needed for this product: navigation, buttons, inputs, selection, cards or lists, feedback, empty/loading/error states.
- A quiet secondary navigation or footer containing only useful supporting actions.
- Use realistic, concise copy and believable data so hierarchy can be judged from the result.

LAYOUT AND COMPOSITION
Build the composition around these principles: ${features}. Use a consistent 8px spacing system, a defined content max-width and no more than three container widths. Establish hierarchy with scale, alignment and spacing before decoration. Adapt gracefully across desktop, tablet and mobile; explicitly decide what wraps, stacks, collapses or scrolls.

TYPOGRAPHY
${typographyGuidance(entry)} Keep body text comfortably readable, line lengths around 45–75 characters where possible, and do not make every heading bold or centered.

COLOR, MATERIAL AND SURFACES
Use ${entry.accent} as a controlled accent rather than an automatic full-page fill. Derive a coherent background, surface, primary text, secondary text, border, accent and state-color palette from the style. Maintain accessible contrast. Use material effects only where they clarify hierarchy or interaction.

COMPONENT LANGUAGE
Translate these characteristic elements into usable components: ${elements}. Define consistent corner, border, shadow, icon, density and interaction rules. Show default, hover, focus, pressed, selected and disabled states where relevant. Do not place every section inside an identical rounded card.

MOTION AND INTERACTION
Use restrained motion to explain state, hierarchy or spatial relationships. Prefer short transitions and intentional easing. Respect reduced-motion preferences. Every interactive element must have a visible focus state and a touch target of roughly 40–44px when appropriate.

AVOID
${avoid}. Also avoid generic AI-SaaS styling, arbitrary purple-blue gradients, decorative charts, excessive pills, meaningless floating cards and mixing unrelated aesthetic systems.

FINAL QUALITY BAR
Deliver one coherent, production-minded visual direction, not several competing themes. Keep the design original; when the reference is a living brand or product, extract principles without copying trademarks, proprietary illustrations or exact layouts. Verify readability, responsive behavior, state consistency and accessibility before considering the UI complete.`;
}

function renderDetail() {
  const entry = entries.find(item => item.id === state.selectedId) || entries[0];
  const inLab = state.lab.some(item => item.entryId === entry.id);
  const completePrompt = buildCompletePrompt(entry);
  view.innerHTML = `
    <div class="detail-topbar"><button class="text-button" id="backButton">← BACK / 返回</button><span class="serial">ARCHIVE №${String(entries.indexOf(entry) + 1).padStart(4, '0')}</span></div>
    <article class="hero-ticket" style="--accent:${entry.accent}">
      <div class="hero-preview">${specimen(entry.preview)}</div>
      <div class="entry-heading">
        <div class="eyebrow"><select id="entryCategorySelect" aria-label="调整词条分类">${state.catalog.categories.map(category => `<option value="${category.id}" ${entryCategory(entry) === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select><span>${entry.era}</span></div>
        <h1>${entry.name}<span>${entry.englishName}</span></h1>
        <p>${entry.summary}</p>
      </div>
    </article>
    <div class="action-row">
      <button class="ink-button" id="labToggle">${inLab ? '✓ 已在 LAB' : '＋ 加入 LAB'}</button>
      <button class="ink-button secondary" id="copyPrompt">复制提示词</button>
    </div>
    <section class="info-block"><h3>VISUAL FEATURES / 视觉特征</h3><div class="bullet-grid">${entry.features.map(x => `<span>${x}</span>`).join('')}</div></section>
    <section class="info-block"><h3>COMMON ELEMENTS / 常见元素</h3><div class="tag-list">${entry.elements.map(x => `<span class="tag">${x}</span>`).join('')}</div></section>
    <section class="info-block"><h3>GOOD FOR / 适合</h3><div class="bullet-grid">${entry.suitableFor.map(x => `<span>${x}</span>`).join('')}</div></section>
    <section class="info-block avoid-list"><h3>CAUTION / 避免</h3><div class="bullet-grid">${entry.avoid.map(x => `<span>${x}</span>`).join('')}</div></section>
    <section class="info-block"><div class="info-title-row"><h3>FULL UI PROMPT / 完整提示词</h3><button class="inline-copy" id="copyPromptInline">复制</button></div><p class="prompt-intro">${escapeHtml(entry.promptZh)}</p><div class="prompt-box full-prompt">${escapeHtml(completePrompt)}</div></section>
  `;
  document.querySelector('#backButton').addEventListener('click', () => setRoute('catalog'));
  document.querySelector('#labToggle').addEventListener('click', () => toggleLab(entry.id));
  document.querySelector('#copyPrompt').addEventListener('click', () => copyText(completePrompt));
  document.querySelector('#copyPromptInline').addEventListener('click', () => copyText(completePrompt));
  document.querySelector('#entryCategorySelect').addEventListener('change', event => {
    state.catalog.categoryAssignments[entry.id] = event.target.value;
    persistCatalog();
    showToast('词条分类已更新');
  });
}

function renderCatalogManager() {
  view.innerHTML = `
    <div class="detail-topbar"><button class="text-button" id="backToCatalog">← BACK / 返回图鉴</button><span class="serial">CATALOG DESK</span></div>
    <header class="lab-header"><small>SOURCE INBOX / 来源收集</small><h1>收录线索</h1><p>先把网上遇到的风格存成一张待整理票根。</p></header>
    <section class="catalog-editor-section">
      <div class="import-form">
        <label class="field-label required-field">SOURCE URL / 来源网址 <b>必填</b><input id="webStyleUrl" type="url" placeholder="粘贴网页或作品链接"></label>
        <label class="field-label optional-field">NOTE / 备注 <b>选填</b><textarea id="webStyleNotes" placeholder="例如：主要喜欢排版密度，不要照搬颜色"></textarea></label>
        <button class="ink-button" id="addWebStyle">保存为待整理票根</button>
      </div>
    </section>
  `;
  document.querySelector('#backToCatalog').addEventListener('click', () => setRoute('catalog'));
  document.querySelector('#addWebStyle').addEventListener('click', addWebStyle);
}

function moveCatalogItem(list, predicate, direction) {
  const index = list.findIndex(predicate);
  const next = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || next < 0 || next >= list.length) return;
  [list[index], list[next]] = [list[next], list[index]];
}

function addCatalogCategoryFromModal() {
  const input = document.querySelector('#modalCategoryName');
  const name = input.value.trim();
  if (!name) { showToast('先写分类名称'); return; }
  const id = `custom-category-${Date.now()}`;
  state.catalog.categories.push({ id, name });
  persistCatalog();
  state.categoriesExpanded = true;
  renderCatalog();
  showToast('新分类已建立');
}

function closeCategoryModal() {
  const modal = document.querySelector('#categoryModal');
  if (modal) modal.hidden = true;
}

function addWebStyle() {
  const url = document.querySelector('#webStyleUrl').value.trim();
  if (!url) { showToast('来源网址是必填项'); return; }
  let parsedUrl;
  try { parsedUrl = new URL(url); } catch { showToast('网址格式不正确'); return; }
  const notes = document.querySelector('#webStyleNotes').value.trim();
  let inbox = state.catalog.categories.find(category => category.id === 'ai-inbox');
  if (!inbox) { inbox = { id: 'ai-inbox', name: '待整理' }; state.catalog.categories.push(inbox); }
  const name = `待整理 · ${parsedUrl.hostname.replace(/^www\./, '')}`;
  const entry = {
    id: `web-style-${Date.now()}`,
    name,
    englishName: 'Source note',
    type: inbox.id,
    era: 'WEB FIND',
    accent: '#86634c',
    preview: 'paper',
    summary: notes || '来自网页的新风格线索，等待补充定义。',
    tags: ['网页收录', '待整理'],
    aliases: [],
    features: ['待整理', '待人工核查'],
    elements: ['来源网页'],
    suitableFor: ['等待补充'],
    avoid: ['未核查前不要视为正式定义'],
    promptZh: '该词条尚未完成提示词整理。',
    promptEn: 'This source note is awaiting curation.',
    related: [], conflicts: [], origin: 'web', sourceUrl: url, awaitingAI: true
  };
  entries.push(entry);
  state.catalog.customEntries.push(entry);
  state.catalog.entryOrder = orderedCatalogEntries().map(item => item.id);
  state.catalog.categoryAssignments[entry.id] = inbox.id;
  persistCatalog();
  showToast('已保存到待整理');
  setRoute('detail', entry.id);
}

function bindCatalogLongPress() {
  document.querySelectorAll('#catalogList [data-entry]').forEach(card => {
    card.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      finishCatalogDrag(null, false);
      catalogDrag.card = card;
      catalogDrag.wrapper = card.closest('.mini-ticket-shadow');
      catalogDrag.pointerId = event.pointerId;
      catalogDrag.startX = event.clientX;
      catalogDrag.startY = event.clientY;
      catalogDrag.lastY = event.clientY;
      clearTimeout(catalogDrag.timer);
      catalogDrag.timer = setTimeout(() => {
        catalogDrag.active = true;
        catalogDrag.suppressClick = true;
        catalogDrag.wrapper.classList.add('dragging');
        navigator.vibrate?.(15);
        showToast('已拿起票根，拖到新位置后松开');
      }, 360);
      window.addEventListener('pointermove', handleCatalogPointerMove, { passive: false });
      window.addEventListener('pointerup', handleCatalogPointerUp);
      window.addEventListener('pointercancel', handleCatalogPointerUp);
    });
  });
}

function handleCatalogPointerMove(event) {
  if (!catalogDrag.card || event.pointerId !== catalogDrag.pointerId) return;
  const distance = Math.hypot(event.clientX - catalogDrag.startX, event.clientY - catalogDrag.startY);
  if (!catalogDrag.active && distance > 8) {
    clearTimeout(catalogDrag.timer);
    return;
  }
  if (!catalogDrag.active) return;
  event.preventDefault();
  catalogDrag.lastY = event.clientY;
  const deltaY = event.clientY - catalogDrag.startY;
  catalogDrag.wrapper.style.transform = `translateY(${deltaY}px) scale(1.025) rotate(-.5deg)`;
  catalogDrag.wrapper.style.pointerEvents = 'none';
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('.mini-ticket-shadow');
  catalogDrag.wrapper.style.pointerEvents = '';
  document.querySelectorAll('.drop-before,.drop-after').forEach(item => item.classList.remove('drop-before', 'drop-after'));
  if (!target || target === catalogDrag.wrapper || target.parentElement?.id !== 'catalogList') {
    catalogDrag.dropTarget = null;
    return;
  }
  const box = target.getBoundingClientRect();
  catalogDrag.dropTarget = target;
  catalogDrag.dropAfter = event.clientY >= box.top + box.height / 2;
  target.classList.add(catalogDrag.dropAfter ? 'drop-after' : 'drop-before');
  const viewBox = view.getBoundingClientRect();
  if (event.clientY < viewBox.top + 44) view.scrollTop -= 8;
  if (event.clientY > viewBox.bottom - 44) view.scrollTop += 8;
}

function handleCatalogPointerUp(event) {
  if (!catalogDrag.card || event.pointerId !== catalogDrag.pointerId) return;
  finishCatalogDrag(catalogDrag.card, true);
}

function mergeVisibleOrder(visibleIds) {
  const visibleSet = new Set(visibleIds);
  const allIds = orderedCatalogEntries().map(entry => entry.id);
  const positions = allIds.map((id, index) => visibleSet.has(id) ? index : -1).filter(index => index >= 0);
  positions.forEach((position, index) => { allIds[position] = visibleIds[index]; });
  state.catalog.entryOrder = allIds;
  persistCatalog();
}

function finishCatalogDrag(card, commit = true) {
  const wasActive = catalogDrag.active && catalogDrag.card === card;
  clearTimeout(catalogDrag.timer);
  window.removeEventListener('pointermove', handleCatalogPointerMove);
  window.removeEventListener('pointerup', handleCatalogPointerUp);
  window.removeEventListener('pointercancel', handleCatalogPointerUp);
  if (wasActive && commit) {
    const visibleIds = [...document.querySelectorAll('#catalogList [data-entry]')].map(item => item.dataset.entry);
    const movingId = card.dataset.entry;
    const targetId = catalogDrag.dropTarget?.querySelector('[data-entry]')?.dataset.entry;
    if (targetId && targetId !== movingId) {
      const nextOrder = visibleIds.filter(id => id !== movingId);
      let targetIndex = nextOrder.indexOf(targetId);
      if (catalogDrag.dropAfter) targetIndex += 1;
      nextOrder.splice(targetIndex, 0, movingId);
      mergeVisibleOrder(nextOrder);
    }
    showToast('票根顺序已保存');
  }
  catalogDrag.wrapper?.classList.remove('dragging');
  if (catalogDrag.wrapper) catalogDrag.wrapper.style.transform = '';
  document.querySelectorAll('.drop-before,.drop-after').forEach(item => item.classList.remove('drop-before', 'drop-after'));
  catalogDrag.active = false;
  catalogDrag.card = null;
  catalogDrag.wrapper = null;
  catalogDrag.pointerId = null;
  catalogDrag.dropTarget = null;
  setTimeout(() => { catalogDrag.suppressClick = false; }, 120);
  if (commit && wasActive && state.route === 'catalog') renderCatalog();
}

function moveCatalogEntryWithKeyboard(entryId, direction) {
  const visibleIds = [...document.querySelectorAll('#catalogList [data-entry]')].map(item => item.dataset.entry);
  const index = visibleIds.indexOf(entryId);
  const next = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || next < 0 || next >= visibleIds.length) return;
  [visibleIds[index], visibleIds[next]] = [visibleIds[next], visibleIds[index]];
  mergeVisibleOrder(visibleIds);
  renderCatalog();
  document.querySelector(`[data-entry="${entryId}"]`)?.focus();
  showToast('票根顺序已保存');
}

function toggleLab(entryId) {
  const index = state.lab.findIndex(item => item.entryId === entryId);
  if (index >= 0) {
    state.lab.splice(index, 1);
    recalculateLabWeights();
    showToast('已从 LAB 移除');
  } else {
    if (state.lab.length >= 4) { showToast('LAB 最多同时融合 4 种风格'); return; }
    state.lab.push({ entryId, strength: state.lab.length ? 30 : 70, weight: 0 });
    recalculateLabWeights();
    showToast('已加入 LAB');
  }
  persistLab();
  if (state.route === 'detail') renderDetail(); else renderLab();
}

function recalculateLabWeights() {
  const count = state.lab.length;
  if (!count) return;
  state.lab.forEach(item => { if (item.strength == null) item.strength = item.weight ?? 50; });
  const strengths = state.lab.map(item => Math.max(0, Number(item.strength) || 0));
  const total = strengths.reduce((sum, value) => sum + value, 0);
  const raw = strengths.map(value => total > 0 ? value / total * 100 : 100 / count);
  const rounded = raw.map(Math.floor);
  let remainder = 100 - rounded.reduce((sum, value) => sum + value, 0);
  raw.map((value, index) => ({ index, fraction: value - rounded[index] })).sort((a, b) => b.fraction - a.fraction).forEach(item => { if (remainder > 0) { rounded[item.index] += 1; remainder -= 1; } });
  state.lab.forEach((item, index) => { item.weight = rounded[index]; });
}

function getConflictText() {
  const ids = state.lab.map(item => item.entryId);
  const pairs = [];
  state.lab.forEach(item => {
    const entry = entries.find(e => e.id === item.entryId);
    (entry?.conflicts || []).forEach(id => {
      if (ids.includes(id)) {
        const other = entries.find(e => e.id === id);
        const label = [entry.name, other.name].sort().join(' × ');
        if (!pairs.includes(label)) pairs.push(label);
      }
    });
  });
  return pairs.length ? `检测到潜在冲突：${pairs.join('；')}。建议把其中一个设为主风格，另一个只用于局部强调，并优先统一对比度、材质与边缘规则。` : '当前组合没有明显的规则冲突。仍建议保留一个占主导的视觉系统。';
}

function buildRecipe() {
  const sorted = [...state.lab].sort((a, b) => b.weight - a.weight);
  const zhParts = sorted.map(item => {
    const e = entries.find(x => x.id === item.entryId);
    return `${e.name}（权重 ${item.weight}%）：${e.features.slice(0, 3).join('、')}`;
  });
  const enParts = sorted.map(item => {
    const e = entries.find(x => x.id === item.entryId);
    return `${e.englishName} at ${item.weight}% influence — ${e.features.slice(0, 4).join(', ')}`;
  });
  const primary = entries.find(x => x.id === sorted[0]?.entryId);
  const combinedElements = [...new Set(sorted.flatMap(item => entries.find(x => x.id === item.entryId)?.elements || []))].slice(0, 8);
  const combinedAvoid = [...new Set(sorted.flatMap(item => entries.find(x => x.id === item.entryId)?.avoid || []))].slice(0, 8);
  return {
    zh: `为${state.context || '数字产品'}建立完整且可执行的融合视觉语言。整体气质：${state.mood || '清晰、统一'}。风格主次：${zhParts.join('；')}。以“${primary?.name || '主风格'}”决定网格、字体和组件骨架，其余风格只提供局部材质、色彩或装饰。页面需包含清晰导航、核心任务区、真实内容区、关键组件状态和必要的次级操作。${state.mustKeep ? `必须保留：${state.mustKeep}。` : ''}${state.avoid ? `禁止出现：${state.avoid}。` : ''}统一间距、字体角色、边缘、色彩 token、交互反馈与响应式规则，并检查可读性和无障碍。`,
    en: `Create a polished, high-fidelity responsive ${state.context || 'digital product'} with a ${state.mood || 'clear and coherent'} mood.

STYLE HIERARCHY
Blend the following influences in strict priority order: ${enParts.join('; ')}. Let ${primary?.englishName || 'the primary style'} control the grid, typography, density and component skeleton. Use the remaining styles only for selected color, material, imagery or decorative accents. Do not split the page into unrelated themed sections.

PAGE STRUCTURE
Include a compact global header, one focused primary task or hero area, two to four meaningful content sections based on the real product brief, representative interactive components with realistic content and states, and a quiet secondary navigation or footer. Do not invent dashboards, statistics, testimonials or pricing blocks unless the product actually needs them.

VISUAL SYSTEM
Use these characteristic elements selectively: ${combinedElements.join(', ')}. Establish semantic tokens for background, surface, primary and secondary text, border, accent, success, warning and error. Use a consistent 8px spacing system, one content max-width and no more than three container widths.

TYPOGRAPHY
${primary ? typographyGuidance(primary) : 'Use no more than two compatible font families with clear display, heading, body, label and metadata roles.'} Keep body copy readable and avoid making every heading bold or centered.

COMPONENTS AND INTERACTION
Define consistent corner, border, shadow, icon and density rules. Show default, hover, focus, pressed, selected, disabled, loading, empty and error states where relevant. Motion must explain state or spatial relationships, remain restrained and respect reduced-motion preferences.

RESPONSIVE AND ACCESSIBILITY
Adapt intentionally across desktop, tablet and mobile. Decide what wraps, stacks, collapses or scrolls. Maintain accessible contrast, visible focus states and practical touch targets.

MUST PRESERVE
${state.mustKeep || 'The primary product task, content hierarchy and coherent visual identity.'}

AVOID
${[state.avoid, ...combinedAvoid].filter(Boolean).join('; ')}. Also avoid generic AI-SaaS cards, arbitrary purple-blue gradients, excessive pills, decorative charts and aesthetic effects that reduce usability.

FINAL OUTPUT
Return one coherent, production-minded direction with realistic content. Verify hierarchy, readability, state consistency, responsive behavior and accessibility before considering the interface complete.`
  };
}

function renderLab() {
  const recipe = state.lab.length ? buildRecipe() : null;
  view.innerHTML = `
    <header class="lab-header"><small>EXPERIMENT COUNTER / 试验台</small><h1>STYLE LAB</h1><p>把喜欢的票根拆成配料。建议 2–3 种，最多 4 种；总权重始终为 100%。</p></header>
    ${state.lab.length ? `
      <div class="lab-total"><span>NORMALIZED / 换算总计</span><b>100%</b><i>${state.lab.length} / 4 风格</i></div>
      <div class="strength-hint">滑块表示自由份量，互不牵动；右侧显示后台换算后的实际占比。</div>
      <div id="labItems">${state.lab.map(item => { const e = entries.find(x => x.id === item.entryId); return `
        <article class="lab-item" style="--accent:${e.accent}">
          <div class="lab-item-head"><b>${e.name}</b><button class="remove-item" data-remove="${e.id}" aria-label="移除${e.name}">×</button></div>
          <div class="weight-row"><input type="range" min="0" max="100" step="5" value="${item.strength ?? item.weight}" data-weight="${e.id}" aria-label="${e.name}份量"><span class="weight-value">${item.weight}%</span></div>
        </article>`; }).join('')}</div>
      <div class="form-grid">
        <label class="field-label">APPLICATION / 应用场景<select id="context"><option>桌面端小工具</option><option>移动端应用</option><option>网页首屏</option><option>作品集</option><option>聊天界面</option><option>播放器</option></select></label>
        <label class="field-label">MOOD / 情绪<input id="mood" value="${escapeHtml(state.mood)}"></label>
        <label class="field-label">MUST KEEP / 必须保留<input id="mustKeep" value="${escapeHtml(state.mustKeep)}" placeholder="例如：大幅例图、黑白正文"></label>
        <label class="field-label">AVOID / 禁止出现<textarea id="avoid">${escapeHtml(state.avoid)}</textarea></label>
      </div>
      <div class="conflict-note">${getConflictText()}</div>
      <section class="recipe"><h3>GENERATED RECIPE / 生成配方</h3><p id="recipeZh">${recipe.zh}</p><p id="recipeEn">${recipe.en}</p></section>
      <div class="lab-actions"><button class="ink-button" id="copyRecipe">复制英文配方</button><button class="ink-button secondary" id="saveStyle">保存到“我的”</button></div>
    ` : `<div class="empty-state"><div class="empty-icon">⌘</div><h2>实验台还是空的</h2><p>回到图鉴，把两三张喜欢的风格票根加入这里。一个做主风格，其余作为局部配料。</p><button class="ink-button secondary" id="goCatalog" style="margin-top:14px">去挑选风格</button></div>`}
  `;
  if (!state.lab.length) {
    document.querySelector('#goCatalog').addEventListener('click', () => setRoute('catalog'));
    return;
  }
  const contextSelect = document.querySelector('#context');
  contextSelect.value = state.context;
  document.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => toggleLab(button.dataset.remove)));
  document.querySelectorAll('[data-weight]').forEach(slider => slider.addEventListener('input', () => {
    const active = state.lab.find(item => item.entryId === slider.dataset.weight);
    active.strength = Number(slider.value);
    recalculateLabWeights();
    document.querySelectorAll('[data-weight]').forEach(input => {
      const item = state.lab.find(x => x.entryId === input.dataset.weight);
      input.nextElementSibling.textContent = `${item.weight}%`;
    });
    persistLab(); updateRecipeOnly();
  }));
  [['context','context'],['mood','mood'],['mustKeep','mustKeep'],['avoid','avoid']].forEach(([id,key]) => document.querySelector(`#${id}`).addEventListener('input', event => { state[key] = event.target.value; updateRecipeOnly(); }));
  document.querySelector('#copyRecipe').addEventListener('click', () => copyText(buildRecipe().en));
  document.querySelector('#saveStyle').addEventListener('click', savePersonalStyle);
}

function updateRecipeOnly() {
  const recipe = buildRecipe();
  document.querySelector('#recipeZh').textContent = recipe.zh;
  document.querySelector('#recipeEn').textContent = recipe.en;
}

function savePersonalStyle() {
  const recipe = buildRecipe();
  const lead = [...state.lab].sort((a,b) => b.weight-a.weight).slice(0,2).map(item => entries.find(e => e.id === item.entryId).name);
  state.personal.unshift({ id: `personal-${Date.now()}`, origin: 'lab', name: `${lead.join(' × ')} 实验`, createdAt: new Date().toISOString(), items: state.lab.map(x => ({...x})), context: state.context, mood: state.mood, mustKeep: state.mustKeep, avoid: state.avoid, ...recipe });
  localStorage.setItem(storage.personal, JSON.stringify(state.personal));
  showToast('已保存到“我的风格”');
  setTimeout(() => setRoute('mine'), 500);
}

function personalSourceLabel(style) {
  if (style.origin === 'lab' || style.items?.length) return `LAB · ${style.items?.length || 0} 种配料`;
  if (style.sourceType === 'images') return '例图提取 · 个人收录';
  if (style.sourceType === 'manual') return '文字录入 · 个人收录';
  return `${(style.sourceType || 'manual').toUpperCase()} · 历史收录`;
}

function validPersonalCover(style) {
  return typeof style.coverImage === 'string' && /^data:image\/(?:jpeg|png|webp);base64,/i.test(style.coverImage);
}

function personalCoverMarkup(style, compact = false) {
  if (validPersonalCover(style)) return `<img src="${escapeHtml(style.coverImage)}" alt="${escapeHtml(style.name)}的风格例图">`;
  const labEntries = (style.items || []).map(item => entries.find(entry => entry.id === item.entryId)).filter(Boolean).slice(0, 2);
  if (labEntries.length) return `<div class="personal-lab-cover ${compact ? 'compact' : ''}">${labEntries.map(entry => `<div style="--accent:${entry.accent}">${specimen(entry.preview)}</div>`).join('')}<small>LAB RECIPE</small></div>`;
  const mark = escapeHtml((style.name || '我的风格').trim().slice(0, 2).toUpperCase());
  return `<div class="personal-cover-fallback ${compact ? 'compact' : ''}"><small>PERSONAL STYLE</small><b>${mark}</b><i>NO IMAGE YET</i></div>`;
}

function personalPrompt(style, language = 'zh') {
  const direct = language === 'zh' ? (style.promptZh || style.zh) : (style.promptEn || style.en);
  const fromAnalysis = language === 'zh' ? style.analysisResult?.promptZhBase || style.analysisResult?.promptZh : style.analysisResult?.promptEnBase || style.analysisResult?.promptEn;
  return stripFidelityPrompt(direct || fromAnalysis || '', language);
}

function personalCreatedLabel(style) {
  const date = new Date(style.createdAt);
  return Number.isNaN(date.getTime()) ? '日期未记录' : date.toLocaleDateString('zh-CN');
}

function personalSourceDetails(style) {
  if (style.origin === 'lab' || style.items?.length) {
    return (style.items || []).map(item => {
      const entry = entries.find(candidate => candidate.id === item.entryId);
      return entry ? `${entry.name} ${Number(item.weight) || 0}%` : '';
    }).filter(Boolean);
  }
  if (Array.isArray(style.source)) return style.source.map(item => item?.name || '').filter(Boolean);
  if (style.sourceType === 'figma' && style.source) return [String(style.source)];
  if (style.sourceType === 'skill') return ['已保存 Skill 原文，可在下方展开查看'];
  if (style.sourceType === 'manual') return ['文字录入的个人风格规则'];
  return [];
}

function personalAnalysisMarkup(style) {
  const result = style.analysisResult;
  if (!result) return `<section class="info-block"><h3>STYLE NOTES / 风格记录</h3><p class="personal-body-copy">${escapeHtml(style.summary || style.mood || '这张馆藏还没有 AI 结构化解析，可以通过右上角“编辑”补充说明与完整 Prompt。')}</p></section>`;
  const groups = [
    ['可迁移风格 DNA', result.transferablePrinciples],
    ['核心气质', result.coreMood],
    ['色彩规则', result.colorRules],
    ['字体规则', result.typographyRules],
    ['布局规则', result.layoutRules],
    ['材质规则', result.materialRules],
    ['组件规则', result.componentRules],
    ['必须保留', result.mustKeep],
    ['避免', result.avoid],
    ['已排除的原图专属内容', result.excludedSourceDetails],
    ['跨产品自检', result.transferCheck]
  ].filter(([, values]) => Array.isArray(values) && values.length);
  if (!groups.length) return `<section class="info-block"><h3>STYLE NOTES / 风格记录</h3><p class="personal-body-copy">${escapeHtml(result.summary || style.summary || style.mood || '已保存这套个人风格。')}</p></section>`;
  return `<section class="info-block personal-rule-book"><h3>STYLE DNA / 可迁移规则</h3><div class="analysis-rules">${groups.map(([label, values]) => renderRuleGroup(label, values)).join('')}</div></section>`;
}

function renderPersonalDetail() {
  const index = state.personal.findIndex(style => style.id === state.selectedId);
  if (index < 0) { setRoute('mine'); return; }
  const style = state.personal[index];
  const editing = state.personalEditingId === style.id;
  const fidelity = style.fidelity || 'balanced';
  const promptZh = personalPrompt(style, 'zh');
  const promptEn = personalPrompt(style, 'en');
  const sources = personalSourceDetails(style);
  const sourceRaw = typeof style.source === 'string' && ['skill', 'manual'].includes(style.sourceType) ? style.source : '';
  view.innerHTML = `
    <div class="detail-topbar personal-detail-topbar">
      <button class="text-button" id="backToMine">← BACK / 我的风格</button>
      <div class="personal-detail-actions">${editing ? '<button class="text-button" id="cancelPersonalEdit">取消</button><button class="text-button accent" id="savePersonalEdit">保存</button>' : '<button class="text-button" id="editPersonal">编辑</button><button class="text-button danger" id="deletePersonal">删除</button>'}</div>
    </div>
    <article class="hero-ticket personal-hero" style="--accent:#a64f42">
      <div class="hero-preview personal-hero-preview">${personalCoverMarkup(style)}</div>
      <div class="entry-heading">
        <div class="eyebrow"><span>${personalSourceLabel(style)}</span><span>${personalCreatedLabel(style)} · MY.${String(index + 1).padStart(3, '0')}</span></div>
        ${editing ? `
          <div class="personal-edit-fields">
            <label class="field-label required-field">STYLE NAME / 风格名称 <b>必填</b><input id="editPersonalName" value="${escapeHtml(style.name || '')}" maxlength="48"></label>
            <label class="field-label optional-field">MOOD / 一句话印象 <b>选填</b><input id="editPersonalMood" value="${escapeHtml(style.mood || '')}" maxlength="120"></label>
            <label class="field-label optional-field">SUMMARY / 风格说明 <b>选填</b><textarea id="editPersonalSummary">${escapeHtml(style.summary || '')}</textarea></label>
            <label class="edit-cover-control">更换例图<input id="editPersonalCover" type="file" accept="image/png,image/jpeg,image/webp"></label>
          </div>` : `<h1>${escapeHtml(style.name || '未命名个人风格')}</h1><p>${escapeHtml(style.summary || style.mood || '这是一张尚待补充说明的个人风格票根。')}</p>`}
      </div>
    </article>
    ${editing ? `
      <section class="info-block personal-prompt-editor"><label class="field-label optional-field">完整中文 Prompt <b>选填</b><textarea id="editPersonalPromptZh">${escapeHtml(promptZh)}</textarea></label><label class="field-label optional-field">Full English Prompt <b>选填</b><textarea id="editPersonalPromptEn">${escapeHtml(promptEn)}</textarea></label></section>
    ` : `
      ${sources.length ? `<section class="info-block"><h3>SOURCE / 来源记录</h3><div class="tag-list">${sources.map(source => `<span class="tag">${escapeHtml(source)}</span>`).join('')}</div>${sourceRaw ? `<details class="source-original"><summary>展开原始${style.sourceType === 'skill' ? ' Skill' : '规则'}</summary><pre>${escapeHtml(sourceRaw)}</pre></details>` : ''}</section>` : ''}
      ${style.items?.length ? `<section class="info-block"><h3>LAB FORMULA / 配方信息</h3><div class="bullet-grid"><span>${escapeHtml(style.context || '应用场景未记录')}</span><span>${escapeHtml(style.mustKeep ? `保留：${style.mustKeep}` : '未指定必须保留')}</span><span>${escapeHtml(style.avoid ? `避免：${style.avoid}` : '未指定禁止项')}</span></div></section>` : ''}
      ${personalAnalysisMarkup(style)}
      ${(promptZh || promptEn) ? `<section class="info-block personal-prompt-section"><div class="info-title-row"><h3>PROMPT / 可直接调用</h3><span class="serial">${fidelityPresets[fidelity]?.zh || '平衡迁移'}</span></div><div class="saved-prompt-tools"><span><b>STYLE APPLICATION / 调用档位</b><small>改变复制出的 Prompt，不改动馆藏原始规则</small></span>${renderFidelitySwitch(fidelity, 'personal-detail')}</div>${promptZh ? `<details open><summary>完整中文 Prompt <button type="button" data-copy-personal="zh">复制</button></summary><div class="prompt-box full-prompt">${escapeHtml(buildFidelityPrompt(promptZh, fidelity, 'zh'))}</div></details>` : ''}${promptEn ? `<details><summary>Full English Prompt <button type="button" data-copy-personal="en">复制</button></summary><div class="prompt-box full-prompt">${escapeHtml(buildFidelityPrompt(promptEn, fidelity, 'en'))}</div></details>` : ''}</section>` : ''}
    `}
    <div class="modal-backdrop" id="deletePersonalModal" hidden><div class="paper-modal delete-personal-modal" role="dialog" aria-modal="true" aria-labelledby="deletePersonalTitle"><button type="button" class="modal-close" id="closeDeletePersonal">×</button><small>REMOVE FROM ARCHIVE / 删除馆藏</small><h2 id="deletePersonalTitle">确定删除“${escapeHtml(style.name || '这张票根')}”吗？</h2><p>它只会从这台电脑的私人馆藏中移除，删除后无法恢复。</p><div class="delete-confirm-actions"><button class="ink-button secondary" type="button" id="cancelDeletePersonal">先保留</button><button class="ink-button danger-fill" type="button" id="confirmDeletePersonal">确认删除</button></div></div></div>
  `;

  document.querySelector('#backToMine').addEventListener('click', () => setRoute('mine'));
  if (editing) {
    document.querySelector('#cancelPersonalEdit').addEventListener('click', () => { state.personalEditingId = null; renderPersonalDetail(); });
    document.querySelector('#savePersonalEdit').addEventListener('click', async () => {
      const name = document.querySelector('#editPersonalName').value.trim();
      if (!name) { showToast('风格名称是必填项'); return; }
      const file = document.querySelector('#editPersonalCover').files?.[0];
      let coverImage = style.coverImage || '';
      if (file) {
        try { coverImage = await fileToLocalCover(file); }
        catch { showToast('例图读取失败，请换一张图片'); return; }
      }
      const updated = {
        ...style,
        name,
        mood: document.querySelector('#editPersonalMood').value.trim(),
        summary: document.querySelector('#editPersonalSummary').value.trim(),
        promptZh: stripFidelityPrompt(document.querySelector('#editPersonalPromptZh').value, 'zh'),
        promptEn: stripFidelityPrompt(document.querySelector('#editPersonalPromptEn').value, 'en'),
        coverImage,
        updatedAt: new Date().toISOString()
      };
      if (updated.analysisResult) updated.analysisResult = { ...updated.analysisResult, promptZh: updated.promptZh, promptZhBase: updated.promptZh, promptEn: updated.promptEn, promptEnBase: updated.promptEn };
      const previous = state.personal[index];
      state.personal[index] = updated;
      if (!persistPersonalStyles()) { state.personal[index] = previous; return; }
      state.personalEditingId = null;
      showToast('个人风格已更新');
      renderPersonalDetail();
    });
  } else {
    document.querySelector('#editPersonal').addEventListener('click', () => { state.personalEditingId = style.id; renderPersonalDetail(); });
    const modal = document.querySelector('#deletePersonalModal');
    document.querySelector('#deletePersonal').addEventListener('click', () => { modal.hidden = false; document.querySelector('#confirmDeletePersonal').focus(); });
    const closeModal = () => { modal.hidden = true; };
    document.querySelector('#closeDeletePersonal').addEventListener('click', closeModal);
    document.querySelector('#cancelDeletePersonal').addEventListener('click', closeModal);
    modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
    document.querySelector('#confirmDeletePersonal').addEventListener('click', () => {
      const removed = state.personal.splice(index, 1)[0];
      if (!persistPersonalStyles()) { state.personal.splice(index, 0, removed); return; }
      showToast('已从私人馆藏删除');
      setRoute('mine');
    });
    document.querySelectorAll('[data-personal-detail-fidelity]').forEach(button => button.addEventListener('click', () => {
      style.fidelity = button.dataset.personalDetailFidelity;
      persistPersonalStyles();
      renderPersonalDetail();
    }));
    document.querySelectorAll('[data-copy-personal]').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      const language = button.dataset.copyPersonal;
      copyText(buildFidelityPrompt(personalPrompt(style, language), style.fidelity || 'balanced', language));
    }));
  }
}

function renderMine() {
  view.innerHTML = `
    <header class="lab-header"><small>PERSONAL ARCHIVE / 私人馆藏</small><h1>我的风格</h1><p>既可以保存 Lab 配方，也可以收录你已经形成的个人视觉语言。</p></header>
    <button class="personal-entry" id="openPersonalImport"><span>＋</span><b>收录我的风格</b><small>例图提取 · 文字录入</small></button>
    <section id="personalImport" class="personal-import" hidden>
      <div class="source-tabs" role="tablist" aria-label="个人风格来源">
        <button class="active" data-source="images">例图</button>
        <button data-source="manual">文字录入</button>
      </div>
      <div id="sourcePanel"></div>
    </section>
    <div class="archive-divider"><span>ARCHIVED / 已收藏</span><i>${String(state.personal.length).padStart(2, '0')}</i></div>
    ${state.personal.length ? state.personal.map(style => {
      return `<div class="mini-ticket-shadow personal-ticket-shadow"><article class="mini-ticket personal-ticket" role="button" tabindex="0" data-personal="${escapeHtml(style.id)}" style="--accent:#a64f42"><div class="mini-preview personal-mini-preview">${personalCoverMarkup(style, true)}</div><div class="mini-info"><small>${personalCreatedLabel(style)} · ${personalSourceLabel(style)}</small><h2>${escapeHtml(style.name || '未命名个人风格')}</h2><p>${escapeHtml(style.mood || style.summary || '等待补充风格说明')}</p></div><span class="ticket-code">MY.${String(state.personal.indexOf(style) + 1).padStart(3, '0')}</span></article></div>`;
    }).join('') : `<div class="empty-state compact"><div class="empty-icon">✦</div><h2>私人馆藏还是空的</h2><p>可以从 Lab 保存，也可以用例图提取或直接录入文字规则。</p></div>`}
  `;
  document.querySelector('#openPersonalImport').addEventListener('click', () => {
    const panel = document.querySelector('#personalImport');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) renderSourcePanel();
  });
  document.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
    if (personalDraft.sourceType !== button.dataset.source) {
      Object.assign(personalDraft, { analysis: '', analysisResult: null, lastAnalysisPayload: null, visualDraft: null, refinementPending: false, awaitingAI: undefined });
    }
    personalDraft.sourceType = button.dataset.source;
    document.querySelectorAll('[data-source]').forEach(item => item.classList.toggle('active', item === button));
    renderSourcePanel();
  }));
  document.querySelectorAll('[data-personal]').forEach(card => {
    card.addEventListener('click', () => setRoute('mineDetail', card.dataset.personal));
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setRoute('mineDetail', card.dataset.personal); } });
  });
}

function renderSettings() {
  const settings = state.settings;
  const currentPreset = `${settings.windowWidth}x${settings.windowHeight}`;
  view.innerHTML = `
    <header class="lab-header settings-header"><small>CONTROL ROOM / 控制室</small><h1>设置</h1></header>
    <section class="settings-section">
      <div class="settings-title"><span>01</span><b>DESKTOP WIDGET / 桌面组件</b></div>
      <label class="field-label">WINDOW SIZE / 窗口尺寸
        <select id="windowPreset">
          <option value="320x620" ${currentPreset === '320x620' ? 'selected' : ''}>紧凑票根 · 320 × 620</option>
          <option value="340x720" ${currentPreset === '340x720' ? 'selected' : ''}>标准阅读 · 340 × 720</option>
          <option value="380x820" ${currentPreset === '380x820' ? 'selected' : ''}>长票模式 · 380 × 820</option>
        </select>
      </label>
      <label class="switch-row"><span><b>始终置顶</b><small>钉在所有普通窗口上方</small></span><input id="alwaysOnTop" type="checkbox" ${settings.alwaysOnTop ? 'checked' : ''}><i></i></label>
    </section>
    <section class="settings-section">
      <div class="settings-title"><span>02</span><b>AI GATEWAY / 模型网关</b></div>
      <div class="route-pair">
        <label class="field-label">VISION / 例图解析<select id="visionProvider"><option value="qwen" ${settings.visionProvider === 'qwen' ? 'selected' : ''}>千问</option><option value="kimi" ${settings.visionProvider === 'kimi' ? 'selected' : ''}>Kimi</option></select></label>
        <label class="field-label">TEXT / 文本整理<select id="textProvider"><option value="qwen" ${settings.textProvider === 'qwen' ? 'selected' : ''}>千问（默认）</option><option value="deepseek" ${settings.textProvider === 'deepseek' ? 'selected' : ''}>DeepSeek（备用）</option><option value="kimi" ${settings.textProvider === 'kimi' ? 'selected' : ''}>Kimi（备用）</option></select></label>
      </div>
      <div class="pipeline-summary" id="pipelineSummary"><b>图片解析链路</b><span>${escapeHtml(reviewRouteLabel(settings))}</span></div>
      <details class="advanced-settings"><summary>高级设置</summary><label class="field-label">GATEWAY URL / 网关地址<input id="gatewayUrl" value="${escapeHtml(settings.gatewayUrl)}"></label><div class="route-pair"><label class="field-label">VISION MODEL<input id="visionModel" value="${escapeHtml(settings.visionModel)}"></label><label class="field-label">TEXT MODEL<input id="textModel" value="${escapeHtml(settings.textModel)}"></label></div></details>
      <div class="gateway-presence" id="gatewayPresence"><i></i><span>正在检查本地网关…</span></div>
      <div class="key-vault" id="keyVault">
        ${[['qwen','QWEN'],['deepseek','DEEPSEEK'],['kimi','KIMI']].map(([id,label]) => `<label class="gateway-key-row"><span>${label}<small id="status-${id}">未连接</small></span><input id="key-${id}" type="password" autocomplete="new-password" placeholder="粘贴 Key"><button type="button" data-connect-key="${id}">连接</button></label>`).join('')}
        <p id="secretStorageNote">正在确认 Key 的保存方式…</p>
      </div>
      <div class="gateway-actions"><button class="ink-button secondary" id="checkGateway">检查网关</button><button class="ink-button" id="testVisionGateway">烟测视觉</button><button class="ink-button" id="testTextGateway">烟测文本</button></div>
      <div id="gatewayTestResult" class="gateway-test-result" hidden></div>
      <button class="ink-button settings-save secondary" id="saveSettings">保存设置</button>
    </section>
  `;
  document.querySelector('#windowPreset').addEventListener('change', event => {
    const [width, height] = event.target.value.split('x').map(Number);
    state.settings.windowWidth = width;
    state.settings.windowHeight = height;
    applyWindowPreviewSettings();
  });
  document.querySelector('#alwaysOnTop').addEventListener('change', event => {
    state.settings.alwaysOnTop = event.target.checked;
    desktopBridge?.setAlwaysOnTop(state.settings.alwaysOnTop);
  });
  [['gatewayUrl','gatewayUrl'],['visionProvider','visionProvider'],['visionModel','visionModel'],['textProvider','textProvider'],['textModel','textModel']].forEach(([id,key]) => {
    document.querySelector(`#${id}`).addEventListener('input', event => state.settings[key] = event.target.value);
  });
  document.querySelector('#visionProvider').addEventListener('change', event => {
    const provider = event.target.value;
    if (!providerDefaultModels[provider]) return;
    state.settings.visionModel = providerDefaultModels[provider];
    document.querySelector('#visionModel').value = state.settings.visionModel;
    updatePipelineSummary();
    setGatewayResult('testing', '视觉模型已自动切换', `${provider.toUpperCase()} · ${state.settings.visionModel}。请重新点击烟测。`);
  });
  document.querySelector('#textProvider').addEventListener('change', event => {
    const provider = event.target.value;
    if (!providerDefaultModels[provider]) return;
    state.settings.textModel = providerDefaultModels[provider];
    document.querySelector('#textModel').value = state.settings.textModel;
    updatePipelineSummary();
  });
  document.querySelector('#saveSettings').addEventListener('click', () => {
    localStorage.setItem(storage.settings, JSON.stringify(state.settings));
    applyWindowPreviewSettings();
    showToast('设置已保存');
  });
  document.querySelectorAll('[data-connect-key]').forEach(button => button.addEventListener('click', () => connectGatewayKey(button.dataset.connectKey)));
  document.querySelector('#checkGateway').addEventListener('click', refreshGatewayHealth);
  document.querySelector('#testVisionGateway').addEventListener('click', () => testGatewayRoute('vision'));
  document.querySelector('#testTextGateway').addEventListener('click', () => testGatewayRoute('text'));
  renderGatewayResult();
  refreshGatewayHealth();
}

function updatePipelineSummary() {
  const summary = document.querySelector('#pipelineSummary span');
  if (summary) summary.textContent = reviewRouteLabel(state.settings);
}

function reviewRouteLabel(settings) {
  if (settings.visionProvider === 'qwen' && settings.textProvider === 'qwen') return '千问看图 → 千问文本复审（第二次不看图）';
  return `${settings.visionProvider.toUpperCase()} 看图 → ${settings.textProvider.toUpperCase()} 文本复审`;
}

function setGatewayResult(kind, title, detail) {
  lastGatewayResult = { kind, title, detail, time: new Date() };
  renderGatewayResult();
}

function renderGatewayResult() {
  const box = document.querySelector('#gatewayTestResult');
  if (!box) return;
  if (!lastGatewayResult) { box.hidden = true; return; }
  box.hidden = false;
  box.className = `gateway-test-result ${lastGatewayResult.kind}`;
  box.innerHTML = `<span><b>${escapeHtml(lastGatewayResult.title)}</b><small>${lastGatewayResult.time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</small></span><p>${escapeHtml(lastGatewayResult.detail)}</p>${lastGatewayResult.kind === 'error' ? '<button type="button" id="copyGatewayError">复制完整错误</button>' : ''}`;
  document.querySelector('#copyGatewayError')?.addEventListener('click', () => copyText(`${lastGatewayResult.title}\n${lastGatewayResult.detail}`));
}

function gatewayEndpoint(route) {
  return `${String(state.settings.gatewayUrl || 'http://127.0.0.1:47820/v1').replace(/\/+$/, '')}${route}`;
}

async function gatewayRequest(route, options = {}) {
  if (location.protocol === 'file:') {
    throw new Error('当前是离线预览。请双击 START_STYLE_STUB.cmd，再从本地地址打开');
  }
  let response;
  try {
    response = await fetch(gatewayEndpoint(route), {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
  } catch {
    throw new Error('无法连接本地 AI 网关。请重新双击 START_STYLE_STUB.cmd');
  }
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok) throw new Error(payload.error || `网关请求失败（${response.status}）`);
  return payload;
}

async function refreshGatewayHealth() {
  const presence = document.querySelector('#gatewayPresence');
  if (!presence) return;
  presence.className = 'gateway-presence checking';
  presence.querySelector('span').textContent = '正在检查本地网关…';
  try {
    gatewayHealth = await gatewayRequest('/health');
    presence.className = 'gateway-presence online';
    presence.querySelector('span').textContent = `本地网关已运行 · v${gatewayHealth.version}`;
    const encryptedStorage = gatewayHealth.secretStorage === 'os-encrypted';
    const storageNote = document.querySelector('#secretStorageNote');
    if (storageNote) storageNote.textContent = encryptedStorage
      ? '桌面版会使用 Windows 安全存储加密保存；填一次即可，Key 不进入项目或 GitHub。'
      : '浏览器预览仅保存在本次网关内存中；关闭网关后自动清除。桌面版可加密记住。';
    Object.entries(gatewayHealth.providers || {}).forEach(([id, provider]) => {
      const status = document.querySelector(`#status-${id}`);
      if (!status) return;
      status.textContent = provider.connected ? (encryptedStorage ? '已安全保存' : '已连接') : '未连接';
      status.classList.toggle('connected', provider.connected);
    });
  } catch {
    gatewayHealth = null;
    presence.className = 'gateway-presence offline';
    presence.querySelector('span').textContent = '本地网关未运行 · 请先启动 Style Stub';
    document.querySelectorAll('[id^="status-"]').forEach(status => { status.textContent = '等待网关'; status.classList.remove('connected'); });
  }
}

async function connectGatewayKey(provider) {
  const input = document.querySelector(`#key-${provider}`);
  const button = document.querySelector(`[data-connect-key="${provider}"]`);
  const key = input?.value.trim();
  if (!key) { showToast('先粘贴 API Key'); return; }
  button.disabled = true; button.textContent = '连接中';
  try {
    await gatewayRequest('/config/keys', { method: 'POST', body: JSON.stringify({ provider, key }) });
    input.value = '';
    await refreshGatewayHealth();
    const encryptedStorage = gatewayHealth?.secretStorage === 'os-encrypted';
    setGatewayResult('success', `${provider.toUpperCase()} Key 已连接`, encryptedStorage
      ? 'Key 已由 Windows 加密保存在本机。以后启动桌面版会自动恢复；烟测成功前还不能代表模型调用可用。'
      : 'Key 已进入本地网关内存，关闭网关后会清除；烟测成功前还不能代表模型调用可用。');
    showToast(encryptedStorage ? 'Key 已安全保存到本机' : 'Key 已放入本次网关内存');
  } catch (error) {
    setGatewayResult('error', `${provider.toUpperCase()} Key 连接失败`, error.message);
    showToast(error.message, 7000);
  }
  finally { button.disabled = false; button.textContent = '连接'; }
}

async function testGatewayRoute(kind) {
  const isVision = kind === 'vision';
  const button = document.querySelector(isVision ? '#testVisionGateway' : '#testTextGateway');
  const provider = isVision ? state.settings.visionProvider : state.settings.textProvider;
  const model = isVision ? state.settings.visionModel : state.settings.textModel;
  const routeLabel = isVision ? '视觉' : '文本';
  if (provider === 'custom') { setGatewayResult('error', '自定义供应商暂不可测', '自定义供应商烟测将在下一版开放。'); return; }
  button.disabled = true; button.textContent = '正在烟测';
  setGatewayResult('testing', `${routeLabel}路线正在烟测`, `正在调用 ${provider.toUpperCase()} · ${model}，结果会保留在这里。`);
  try {
    const result = await gatewayRequest('/test', { method: 'POST', body: JSON.stringify({ provider, model }) });
    setGatewayResult('success', `${routeLabel}路线烟测成功`, `${provider.toUpperCase()} · ${result.model}。当前 Key、模型 ID 与接口地址可以正常调用。`);
    showToast(`${provider.toUpperCase()} · ${result.model} 连接成功`);
  } catch (error) {
    setGatewayResult('error', `${routeLabel}路线烟测失败`, error.message);
    showToast(error.message, 7000);
  }
  finally { button.disabled = false; button.textContent = isVision ? '烟测视觉' : '烟测文本'; }
}

function applyWindowPreviewSettings() {
  document.documentElement.style.setProperty('--widget-width', `${state.settings.windowWidth}px`);
  document.documentElement.style.setProperty('--widget-height', `${state.settings.windowHeight}px`);
  desktopBridge?.setWindowSize(state.settings.windowWidth, state.settings.windowHeight);
}

function renderSourcePanel() {
  const panel = document.querySelector('#sourcePanel');
  if (!['images', 'manual'].includes(personalDraft.sourceType)) personalDraft.sourceType = 'manual';
  document.querySelectorAll('[data-source]').forEach(button => button.classList.toggle('active', button.dataset.source === personalDraft.sourceType));
  const commonTop = `<label class="field-label">STYLE NAME / 风格名<input id="personalName" value="${escapeHtml(personalDraft.name || '')}" placeholder="可以先写临时名字"></label>`;
  const imageMode = personalDraft.sourceType === 'images';
  const keyPrivacy = gatewayHealth?.secretStorage === 'os-encrypted' ? 'Key 由 Windows 加密保存在本机。' : 'Key 关闭网关即清除。';
  const commonBottom = `
    <label class="field-label">NOTES / 我已经知道的感觉<textarea id="personalNotes" placeholder="例如：安静、潮湿、非商业产品；不要 SaaS 卡片墙">${escapeHtml(personalDraft.notes || '')}</textarea></label>
    <div class="privacy-note">${imageMode ? '只发送缩小后的图片副本；馆藏仅保存本地封面。' : '文字可以直接保存，AI 整理为可选。'} ${keyPrivacy}</div>
    <div class="model-route compact-route"><b>AI ROUTE</b><span>${imageMode ? '千问看图 → 千问去来源复审' : '直接保存 / 千问可选整理'}</span></div>
    <div class="import-actions"><button class="ink-button" id="analyzePersonal">${imageMode ? '生成 AI 解析' : '让 AI 整理'}</button><button class="ink-button secondary" id="savePersonalDraft">直接存入馆藏</button></div>`;
  let sourceField = '';
  if (imageMode) {
    sourceField = `<label class="upload-zone" for="styleImages"><span>▧</span><b>放入风格例图</b><small>PNG / JPG / WEBP · 可多选</small><input id="styleImages" type="file" accept="image/png,image/jpeg,image/webp" multiple></label><div id="imageQueue" class="image-queue"></div>`;
  } else {
    sourceField = `<label class="field-label required-field">STYLE TEXT / 风格文字 <b>必填</b><textarea id="manualRules" class="tall-input" placeholder="写下风格规则，或粘贴已有 Prompt、tokens、SKILL.md">${escapeHtml(personalDraft.manualRules || '')}</textarea></label>`;
  }
  panel.innerHTML = `<div class="import-form">${commonTop}${sourceField}${commonBottom}<div id="analysisDraft" class="analysis-draft" hidden></div></div>`;
  bindPersonalImport();
  renderImageQueue();
  if (personalDraft.lastAnalysisPayload) renderAnalysisResult(personalDraft.lastAnalysisPayload);
}

function bindPersonalImport() {
  const bindValue = (id, key) => {
    const element = document.querySelector(`#${id}`);
    if (element) element.addEventListener('input', event => personalDraft[key] = event.target.value);
  };
  bindValue('personalName', 'name');
  bindValue('personalNotes', 'notes');
  bindValue('manualRules', 'manualRules');
  const fileInput = document.querySelector('#styleImages');
  if (fileInput) fileInput.addEventListener('change', async event => {
    personalDraft.files = [...event.target.files].slice(0, 4).map(file => ({ name: file.name, size: file.size, type: file.type, file }));
    personalDraft.coverImage = '';
    personalDraft.coverPromise = personalDraft.files[0]?.file ? fileToLocalCover(personalDraft.files[0].file) : null;
    personalDraft.analysisResult = null;
    personalDraft.lastAnalysisPayload = null;
    personalDraft.visualDraft = null;
    personalDraft.refinementPending = false;
    renderImageQueue();
    if (personalDraft.coverPromise) {
      try { personalDraft.coverImage = await personalDraft.coverPromise; }
      catch { personalDraft.coverImage = ''; }
      finally { personalDraft.coverPromise = null; renderImageQueue(); }
    }
  });
  document.querySelector('#analyzePersonal').addEventListener('click', analyzePersonalDraft);
  document.querySelector('#savePersonalDraft').addEventListener('click', saveImportedStyle);
}

function renderImageQueue() {
  const queue = document.querySelector('#imageQueue');
  if (!queue) return;
  queue.innerHTML = `${personalDraft.coverImage ? `<div class="cover-ready"><img src="${escapeHtml(personalDraft.coverImage)}" alt="本地封面预览"><span>LOCAL COVER / 已生成本地封面</span></div>` : personalDraft.coverPromise ? '<div class="cover-ready pending"><span>正在生成本地封面…</span></div>' : ''}${personalDraft.files.map((file, index) => `<span><i>${String(index + 1).padStart(2, '0')}</i>${escapeHtml(file.name)}<small>${Math.max(1, Math.round(file.size / 1024))} KB</small></span>`).join('')}`;
}

async function fileToLocalCover(file) {
  const bitmap = await createImageBitmap(file);
  const width = 300;
  const height = 200;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#eee7db';
  context.fillRect(0, 0, width, height);
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const drawWidth = bitmap.width * scale;
  const drawHeight = bitmap.height * scale;
  context.drawImage(bitmap, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.72);
}

async function fileToAnalysisImage(item) {
  const file = item.file;
  if (!file) throw new Error(`请重新选择图片：${item.name}`);
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f4efe4';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return { name: item.name, type: 'image/jpeg', dataUrl: canvas.toDataURL('image/jpeg', 0.86) };
}

function renderRuleGroup(label, values) {
  if (!Array.isArray(values) || !values.length) return '';
  return `<section><b>${label}</b><ul>${values.map(value => `<li>${escapeHtml(value)}</li>`).join('')}</ul></section>`;
}

function renderAnalysisResult(payload) {
  const result = payload.analysis;
  const draft = document.querySelector('#analysisDraft');
  if (!draft) return;
  result.promptZhBase ||= stripFidelityPrompt(result.promptZh, 'zh');
  result.promptEnBase ||= stripFidelityPrompt(result.promptEn, 'en');
  const fidelity = personalDraft.fidelity || 'balanced';
  const confidence = Number(result.confidence?.overall);
  const pipelineLabel = Array.isArray(payload.pipeline) && payload.pipeline.length
    ? payload.pipeline.map(stage => String(stage.provider || '').toUpperCase()).filter(Boolean).join(' → ')
    : `${payload.provider.toUpperCase()} · ${payload.model}`;
  draft.hidden = false;
  draft.className = 'analysis-draft analysis-result';
  draft.innerHTML = `
    <div class="analysis-result-head"><span><b>AI ANALYSIS / 风格解析</b><small>${escapeHtml(pipelineLabel)}${payload.durationMs ? ` · ${Math.max(1, Math.round(payload.durationMs / 1000))}s` : ''}</small></span>${Number.isFinite(confidence) ? `<em>${Math.round(confidence * 100)}% 信心</em>` : ''}</div>
    ${payload.warning ? `<div class="analysis-warning"><b>REFINEMENT PENDING / 复审未完成</b><p>${escapeHtml(payload.warning)}</p>${payload.refinementPending ? '<button type="button" id="retryRefinement">只重试文本复审</button>' : ''}</div>` : ''}
    <p class="analysis-summary">${escapeHtml(result.summary || result.transferablePrinciples?.[0] || '已完成可迁移视觉规则提取，请结合下方规则与 Prompt 使用。')}</p>
    ${result.nameSuggestions?.length ? `<div class="name-suggestions"><b>命名建议</b>${result.nameSuggestions.map(name => `<button type="button" data-style-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join('')}</div>` : ''}
    <div class="analysis-rules">
      ${renderRuleGroup('可迁移风格 DNA', result.transferablePrinciples)}
      ${renderRuleGroup('迁移到其他产品的方法', result.transferGuidelines)}
      ${renderRuleGroup('核心气质', result.coreMood)}
      ${renderRuleGroup('色彩', result.colorRules)}
      ${renderRuleGroup('字体', result.typographyRules)}
      ${renderRuleGroup('布局', result.layoutRules)}
      ${renderRuleGroup('材质', result.materialRules)}
      ${renderRuleGroup('组件', result.componentRules)}
      ${renderRuleGroup('动效', result.motionRules)}
      ${renderRuleGroup('必须保留', result.mustKeep)}
      ${renderRuleGroup('避免', result.avoid)}
      ${renderRuleGroup('已排除的原图专属内容', result.excludedSourceDetails)}
      ${renderRuleGroup('无法从静态图确认', result.uncertainOrInferred)}
      ${renderRuleGroup('跨产品自检', result.transferCheck)}
      ${renderRuleGroup('判断依据', result.evidence)}
    </div>
    <div class="analysis-fidelity"><span><b>STYLE APPLICATION / 调用档位</b><small>实时改变下方 Prompt，不改动原始风格 DNA</small></span>${renderFidelitySwitch(fidelity, 'draft')}</div>
    <label class="analysis-prompt"><span><b>完整中文 Prompt</b><button type="button" data-copy-analysis="zh">复制</button></span><textarea id="analysisPromptZh">${escapeHtml(buildFidelityPrompt(result.promptZhBase, fidelity, 'zh'))}</textarea></label>
    <label class="analysis-prompt"><span><b>Full English Prompt</b><button type="button" data-copy-analysis="en">复制</button></span><textarea id="analysisPromptEn">${escapeHtml(buildFidelityPrompt(result.promptEnBase, fidelity, 'en'))}</textarea></label>`;
  draft.querySelectorAll('[data-style-name]').forEach(button => button.addEventListener('click', () => {
    personalDraft.name = button.dataset.styleName;
    const input = document.querySelector('#personalName');
    if (input) input.value = personalDraft.name;
  }));
  draft.querySelectorAll('[data-draft-fidelity]').forEach(button => button.addEventListener('click', () => {
    personalDraft.fidelity = button.dataset.draftFidelity;
    button.closest('.fidelity-switch').querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    draft.querySelector('#analysisPromptZh').value = buildFidelityPrompt(result.promptZhBase, personalDraft.fidelity, 'zh');
    draft.querySelector('#analysisPromptEn').value = buildFidelityPrompt(result.promptEnBase, personalDraft.fidelity, 'en');
  }));
  draft.querySelector('#analysisPromptZh')?.addEventListener('input', event => {
    result.promptZhBase = stripFidelityPrompt(event.target.value, 'zh');
    result.promptZh = result.promptZhBase;
  });
  draft.querySelector('#analysisPromptEn')?.addEventListener('input', event => {
    result.promptEnBase = stripFidelityPrompt(event.target.value, 'en');
    result.promptEn = result.promptEnBase;
  });
  draft.querySelectorAll('[data-copy-analysis]').forEach(button => button.addEventListener('click', () => {
    const language = button.dataset.copyAnalysis;
    copyText(language === 'zh' ? draft.querySelector('#analysisPromptZh').value : draft.querySelector('#analysisPromptEn').value);
  }));
  draft.querySelector('#retryRefinement')?.addEventListener('click', retryPersonalRefinement);
}

async function retryPersonalRefinement() {
  if (!personalDraft.visualDraft) { showToast('没有可重试的千问视觉草稿'); return; }
  const button = document.querySelector('#retryRefinement');
  button.disabled = true;
  button.textContent = '正在重新审校…';
  try {
    const payload = await gatewayRequest('/refine', {
      method: 'POST',
      body: JSON.stringify({
        provider: state.settings.textProvider,
        model: state.settings.textModel,
        notes: personalDraft.notes || '',
        visualDraft: personalDraft.visualDraft
      })
    });
    payload.pipeline = [
      { role: 'vision', provider: state.settings.visionProvider, model: state.settings.visionModel, status: 'cached' },
      ...(payload.pipeline || [])
    ];
    personalDraft.analysisResult = payload.analysis;
    personalDraft.analysis = payload.analysis.summary;
    personalDraft.refinementPending = false;
    personalDraft.visualDraft = null;
    personalDraft.lastAnalysisPayload = payload;
    renderAnalysisResult(payload);
    showToast('文本复审完成 · 没有重新分析图片');
  } catch (error) {
    button.disabled = false;
    button.textContent = '只重试文本复审';
    showToast(error.message, 7000);
  }
}

async function analyzePersonalDraft() {
  const source = personalDraft.sourceType;
  const text = source === 'manual' ? personalDraft.manualRules : '';
  const hasSource = source === 'images' ? personalDraft.files.length > 0 : Boolean(text?.trim());
  if (!hasSource) { showToast('先放入一种风格来源'); return; }
  const draft = document.querySelector('#analysisDraft');
  draft.hidden = false;
  draft.className = 'analysis-draft loading';
  draft.innerHTML = `<b>AI ANALYSIS / 正在解析</b><p>${source === 'images' ? `第一段由 ${state.settings.visionProvider.toUpperCase()} 提取 ${personalDraft.files.length} 张例图的视觉证据，第二段由 ${state.settings.textProvider.toUpperCase()} 删除原产品内容并生成最终 Prompt……` : '正在把你的文字规则整理成可直接使用的完整提示词……'}</p><small>请保持网关开启。两段式多图分析可能需要几分钟。</small>`;
  const button = document.querySelector('#analyzePersonal');
  button.disabled = true;
  button.textContent = '正在解析…';
  try {
    const images = source === 'images' ? await Promise.all(personalDraft.files.map(fileToAnalysisImage)) : [];
    const provider = source === 'images' ? state.settings.visionProvider : state.settings.textProvider;
    const model = source === 'images' ? state.settings.visionModel : state.settings.textModel;
    const refineProvider = source === 'images' ? state.settings.textProvider : '';
    const refineModel = source === 'images' ? state.settings.textModel : '';
    if (provider === 'custom') throw new Error('自定义供应商将在下一版开放');
    const payload = await gatewayRequest('/analyze', {
      method: 'POST',
      body: JSON.stringify({ sourceType: source, provider, model, refineProvider, refineModel, name: personalDraft.name || '', notes: personalDraft.notes || '', text, images })
    });
    personalDraft.analysisResult = payload.analysis;
    personalDraft.analysis = payload.analysis.summary;
    personalDraft.awaitingAI = false;
    personalDraft.visualDraft = payload.visualDraft || null;
    personalDraft.refinementPending = Boolean(payload.refinementPending);
    personalDraft.lastAnalysisPayload = payload;
    if (!personalDraft.name && payload.analysis.nameSuggestions?.[0]) {
      personalDraft.name = payload.analysis.nameSuggestions[0];
      const nameInput = document.querySelector('#personalName');
      if (nameInput) nameInput.value = personalDraft.name;
    }
    renderAnalysisResult(payload);
    showToast(payload.refinementPending ? '千问看图完成 · 文本复审需要单独重试' : '风格解析完成', payload.refinementPending ? 7000 : 3000);
  } catch (error) {
    draft.className = 'analysis-draft error';
    draft.innerHTML = `<b>ANALYSIS STOPPED / 未完成</b><p>${escapeHtml(error.message)}</p><small>烟测成功只代表连接可用；这里会保留完整生成阶段的具体错误，便于判断是视觉提取还是审校格式问题。</small>`;
    showToast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = '生成 AI 解析';
  }
}

function persistPersonalStyles() {
  try {
    localStorage.setItem(storage.personal, JSON.stringify(state.personal));
    return true;
  } catch {
    showToast('本地馆藏空间不足，请删除旧条目或更换更小的封面', 7000);
    return false;
  }
}

async function saveImportedStyle() {
  const source = personalDraft.sourceType;
  const sourceReady = source === 'images' ? personalDraft.files.length : personalDraft.manualRules?.trim();
  if (!sourceReady) { showToast('先放入一种风格来源'); return; }
  if (personalDraft.refinementPending) { showToast('文本复审尚未完成，请先点击“只重试文本复审”'); return; }
  if (personalDraft.coverPromise) {
    try { personalDraft.coverImage = await personalDraft.coverPromise; }
    catch { personalDraft.coverImage = ''; }
    personalDraft.coverPromise = null;
  }
  const style = {
    id: `personal-${Date.now()}`,
    origin: 'import',
    sourceType: source,
    name: personalDraft.name?.trim() || `未命名个人风格 ${state.personal.length + 1}`,
    createdAt: new Date().toISOString(),
    mood: personalDraft.notes?.trim() || personalDraft.analysis || '等待补充风格说明',
    summary: personalDraft.analysis || '',
    awaitingAI: personalDraft.awaitingAI ?? source === 'images',
    promptZh: personalDraft.analysisResult?.promptZhBase || personalDraft.analysisResult?.promptZh || '',
    promptEn: personalDraft.analysisResult?.promptEnBase || personalDraft.analysisResult?.promptEn || '',
    fidelity: personalDraft.fidelity || 'balanced',
    analysisResult: personalDraft.analysisResult,
    coverImage: personalDraft.coverImage || '',
    source: source === 'images' ? personalDraft.files.map(({ name, size, type }) => ({ name, size, type })) : personalDraft.manualRules
  };
  state.personal.unshift(style);
  if (!persistPersonalStyles()) { state.personal.shift(); return; }
  Object.assign(personalDraft, { name: '', notes: '', files: [], coverImage: '', coverPromise: null, manualRules: '', analysis: '', analysisResult: null, lastAnalysisPayload: null, visualDraft: null, refinementPending: false, fidelity: 'balanced', awaitingAI: false });
  showToast('已收进私人馆藏');
  renderMine();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showToast('已复制到剪贴板'); }
  catch {
    const area = document.createElement('textarea'); area.value = text; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); showToast('已复制到剪贴板');
  }
}

function render() {
  if (state.route === 'catalog') renderCatalog();
  else if (state.route === 'detail') renderDetail();
  else if (state.route === 'catalogManage') renderCatalogManager();
  else if (state.route === 'lab') renderLab();
  else if (state.route === 'mine') renderMine();
  else if (state.route === 'mineDetail') renderPersonalDetail();
  else renderSettings();
  updateCounts();
}

searchInput.addEventListener('input', event => { state.query = event.target.value; if (state.route !== 'catalog') setRoute('catalog'); else renderCatalog(); });
clearSearch.addEventListener('click', () => { searchInput.value = ''; state.query = ''; renderCatalog(); searchInput.focus(); });
document.querySelector('#brandButton').addEventListener('click', () => setRoute('catalog'));
document.querySelector('#settingsShortcut').addEventListener('click', () => setRoute('settings'));
document.querySelector('#desktopMinimize').addEventListener('click', () => desktopBridge?.minimize());
document.querySelector('#desktopClose').addEventListener('click', () => desktopBridge?.close());
document.querySelectorAll('.tab-bar button').forEach(button => button.addEventListener('click', () => setRoute(button.dataset.route)));

applyWindowPreviewSettings();
desktopBridge?.setAlwaysOnTop(state.settings.alwaysOnTop);
recalculateLabWeights();
localStorage.setItem(storage.lab, JSON.stringify(state.lab));
render();

if (location.protocol === 'file:') {
  const notice = document.createElement('div');
  notice.className = 'offline-preview-notice';
  notice.innerHTML = '<b>OFFLINE PREVIEW / AI 未启动</b><span>请双击项目里的 START_STYLE_STUB.cmd</span>';
  document.querySelector('.app-header')?.after(notice);
}
