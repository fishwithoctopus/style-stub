const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.STYLE_STUB_PORT || 47820);
const ROOT = path.resolve(__dirname, '..');
const MAX_BODY_BYTES = 14 * 1024 * 1024;
const APP_VERSION = '0.5.1';

const secrets = { qwen: '', deepseek: '', kimi: '' };
let persistSecrets = null;
let secretStorageMode = 'memory-only';

const providers = {
  qwen: {
    label: '千问',
    baseUrl: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.7-plus',
    vision: true
  },
  deepseek: {
    label: 'DeepSeek',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    vision: false
  },
  kimi: {
    label: 'Kimi',
    baseUrl: process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k3',
    vision: true,
    fixedTemperature: 1
  }
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('请求内容过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(Object.assign(new Error('JSON 格式不正确'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function providerStatus() {
  return Object.fromEntries(Object.keys(providers).map(id => [id, {
    connected: Boolean(secrets[id]),
    label: providers[id].label,
    defaultModel: providers[id].defaultModel,
    vision: providers[id].vision
  }]));
}

function secretSnapshot() {
  return Object.fromEntries(Object.keys(secrets).map(id => [id, secrets[id]]));
}

async function persistSecretSnapshot() {
  if (typeof persistSecrets === 'function') await persistSecrets(secretSnapshot());
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

async function callChat(providerId, model, messages, options = {}) {
  const provider = providers[providerId];
  if (!provider) throw Object.assign(new Error('不支持的模型供应商'), { status: 400 });
  if (!secrets[providerId]) throw Object.assign(new Error(`${provider.label} 尚未连接 Key`), { status: 401 });
  if (options.hasImages && !provider.vision) throw Object.assign(new Error(`${provider.label} 当前路由不支持图片输入`), { status: 400 });

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 90000;
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${normalizeBaseUrl(provider.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets[providerId]}`,
        'Content-Type': 'application/json',
        'User-Agent': `Style-Stub/${APP_VERSION}`
      },
      body: JSON.stringify({
        model: model || provider.defaultModel,
        messages,
        temperature: provider.fixedTemperature ?? options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 5000,
        stream: false,
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
        ...(providerId === 'qwen' ? { enable_thinking: options.enableThinking ?? false } : {})
      }),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error(`模型响应超过 ${Math.round(timeoutMs / 1000)} 秒，请减少图片后重试`), { status: 504 });
    throw Object.assign(new Error(`无法连接 ${provider.label}：${error.message}`), { status: 502 });
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw Object.assign(new Error(`${provider.label} 返回了无法解析的响应`), { status: 502 }); }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `${provider.label} 请求失败`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  const choice = data?.choices?.[0];
  const finishReason = choice?.finish_reason || '';
  if (finishReason === 'length') throw Object.assign(new Error(`${provider.label} 输出达到长度上限，内容被截断`), { status: 502 });
  if (finishReason === 'content_filter') throw Object.assign(new Error(`${provider.label} 输出被内容过滤器中断`), { status: 502 });
  if (finishReason === 'insufficient_system_resource') throw Object.assign(new Error(`${provider.label} 当前推理资源不足`), { status: 503 });
  const content = choice?.message?.content;
  if (typeof content !== 'string') throw Object.assign(new Error(`${provider.label} 没有返回文本结果`), { status: 502 });
  return { content, usage: data.usage || null, model: data.model || model || provider.defaultModel, durationMs: Date.now() - startedAt, finishReason };
}

function extractJson(text) {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('模型没有返回有效 JSON');
  }
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item).trim()).filter(Boolean).slice(0, 12);
}

const analysisFieldNames = [
  'nameSuggestions', 'summary', 'transferablePrinciples', 'excludedSourceDetails',
  'uncertainOrInferred', 'transferGuidelines', 'transferCheck', 'coreMood',
  'colorRules', 'typographyRules', 'layoutRules', 'materialRules', 'componentRules',
  'motionRules', 'mustKeep', 'avoid', 'evidence', 'confidence', 'promptZh', 'promptEn'
];

function selectAnalysisPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  let best = value;
  let bestScore = analysisFieldNames.filter(key => Object.prototype.hasOwnProperty.call(value, key)).length;
  const visit = (candidate, depth) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || depth > 3) return;
    const score = analysisFieldNames.filter(key => Object.prototype.hasOwnProperty.call(candidate, key)).length;
    if (score > bestScore) { best = candidate; bestScore = score; }
    Object.values(candidate).forEach(child => visit(child, depth + 1));
  };
  visit(value, 0);
  return best;
}

function normalizeAnalysis(value) {
  const result = selectAnalysisPayload(value);
  const confidence = result.confidence && typeof result.confidence === 'object' ? result.confidence : {};
  const normalized = {
    nameSuggestions: stringArray(result.nameSuggestions).slice(0, 5),
    summary: String(result.summary || '').trim(),
    transferablePrinciples: stringArray(result.transferablePrinciples),
    excludedSourceDetails: stringArray(result.excludedSourceDetails),
    uncertainOrInferred: stringArray(result.uncertainOrInferred),
    transferGuidelines: stringArray(result.transferGuidelines),
    transferCheck: stringArray(result.transferCheck),
    coreMood: stringArray(result.coreMood),
    colorRules: stringArray(result.colorRules),
    typographyRules: stringArray(result.typographyRules),
    layoutRules: stringArray(result.layoutRules),
    materialRules: stringArray(result.materialRules),
    componentRules: stringArray(result.componentRules),
    motionRules: stringArray(result.motionRules),
    mustKeep: stringArray(result.mustKeep),
    avoid: stringArray(result.avoid),
    evidence: stringArray(result.evidence),
    confidence,
    promptZh: String(result.promptZh || '').trim(),
    promptEn: String(result.promptEn || '').trim()
  };
  if (!normalized.summary) {
    normalized.summary = normalized.transferablePrinciples[0]
      || (normalized.coreMood.length ? `以${normalized.coreMood.slice(0, 3).join('、')}为核心的可迁移视觉语言。` : '')
      || '已完成可迁移视觉规则提取；请结合下方规则与完整 Prompt 使用。';
  }
  return normalized;
}

function analysisQuality(analysis) {
  const ruleCount = [
    analysis.transferablePrinciples, analysis.transferGuidelines, analysis.coreMood,
    analysis.colorRules, analysis.typographyRules, analysis.layoutRules,
    analysis.materialRules, analysis.componentRules, analysis.mustKeep, analysis.avoid
  ].reduce((total, items) => total + (Array.isArray(items) ? items.length : 0), 0);
  return {
    usable: analysis.promptZh.length >= 160 && analysis.promptEn.length >= 160 && ruleCount >= 4,
    promptZhLength: analysis.promptZh.length,
    promptEnLength: analysis.promptEn.length,
    ruleCount
  };
}

const analysisSystemPrompt = `You are a senior visual design-system analyst specializing in cross-product style transfer. Your primary task is to extract a reusable visual language, NOT to reconstruct, translate, summarize, or imitate the source product's content and information architecture. Analyze only evidence present in the supplied screenshots or text. Separate observation from inference. Return exactly one JSON object and no markdown.

STRICT ABSTRACTION RULES:
1. Treat visible product content as disposable evidence. Never carry source product names, feature names, tab labels, navigation destinations, copywriting, data values, named entities, page titles, business-specific actions, or screen sequence into the reusable rules or prompts.
2. Never prescribe the same individual icon glyphs or their meanings. Extract only the icon grammar: stroke or fill, weight, geometry, corner treatment, optical size, container, contrast, and selected-state behavior.
3. Describe layout as transferable relationships: grid, alignment, density, spacing rhythm, hierarchy, grouping, anchoring, and responsive behavior. Do not reproduce the source's exact module list or domain-specific information architecture.
4. Describe components by visual anatomy and state behavior, not by the source feature they serve. For example, say "compact evenly distributed navigation destinations with a restrained selected marker," never copy the original tab names.
5. A rule is a style invariant only when it repeats across screenshots, follows a consistent token relationship, or is strongly supported by the user's supplied notes. Generalize one-off content into a visual principle or exclude it.
6. The generated prompts must use neutral placeholders such as [目标产品], [目标用户], [页面任务], [内容模块], [主要操作], and [导航目的地]. They must explicitly tell the receiving generator to derive content and information architecture from the NEW product brief.
7. User notes marked as requirements may override these exclusions. Otherwise, source-specific semantics always go into excludedSourceDetails and nowhere else.
8. Before returning JSON, run a transfer test: imagine the prompt is used for three unrelated products. If any source-specific noun, label, icon, feature, or page structure would be inappropriate, remove or abstract it.
9. Brand marks, mascots, named decorative characters, and recognizable source illustrations are content assets, not style invariants. Generalize them only as an illustration grammar such as low-contrast biomorphic watermark, pastel line mascot, or sparse organic decoration. Never make the original mascot or motif mandatory unless the user explicitly requests it.
10. Static screenshots provide no evidence for animation timing, press scale, easing, responsive breakpoints, dark-mode support, accessibility implementation, or hidden interaction states. Put any useful suggestion in uncertainOrInferred and label it as a recommendation; never present it as an observed rule or mustKeep item.
11. Navigation placement may be generalized when it repeats, but its number of destinations, labels, order, glyphs, and product semantics are never transferable requirements.
12. Do not infer the source product's purpose from visible labels. The target product goal must remain a placeholder unless the user explicitly supplies a new target brief.

Required schema:
{
  "nameSuggestions": ["2-5 concise names"],
  "summary": "one precise summary of the transferable visual language only",
  "transferablePrinciples": ["the highest-level reusable style invariants"],
  "excludedSourceDetails": ["source-specific labels, icons, features and content deliberately excluded"],
  "uncertainOrInferred": ["recommendations that cannot be observed in static screenshots; each explicitly labeled as inference"],
  "transferGuidelines": ["how to apply this visual language to unrelated products"],
  "transferCheck": ["short checks proving the result does not depend on source content"],
  "coreMood": [],
  "colorRules": [],
  "typographyRules": [],
  "layoutRules": [],
  "materialRules": [],
  "componentRules": [],
  "motionRules": ["observed motion only; normally empty for static screenshots"],
  "mustKeep": [],
  "avoid": [],
  "evidence": ["cite screenshot number or exact supplied rule for each important conclusion"],
  "confidence": {"overall": 0.0, "color": 0.0, "typography": 0.0, "layout": 0.0},
  "promptZh": "complete production-ready Chinese UI generation prompt",
  "promptEn": "complete production-ready English UI generation prompt"
}

The two prompts must be directly usable in Figma Make, v0, Lovable, Claude Code or Codex. Each prompt must include: a one-sentence transferable style direction; placeholders for the new product, users and tasks; an instruction to create page structure from the new brief rather than the screenshots; layout and spacing relationships; typography roles; semantic color and material rules; component geometry and states; icon grammar without fixed glyphs; conditional interaction guidance; responsive and accessibility implementation baselines clearly separated from observed style evidence; must-keep rules; negative constraints; requested deliverables; and a final quality checklist. Do not identify exact fonts, brands or historical styles unless supported by evidence. Do not fabricate invisible behavior. Do not copy trademarks, proprietary layouts, source content, original tabs, original icons, original features, or source information architecture.`;

const refinementSystemPrompt = `You are the second-stage editor in a visual style-transfer pipeline. A vision model has already inspected the source screenshots and returned a structured draft. You DO NOT see the screenshots. Your job is to audit that draft, remove source-product leakage, soften unsupported absolutes, and produce a reusable visual system for unrelated products. Return exactly one compact JSON patch using the schema at the end of this instruction and no markdown.

NON-NEGOTIABLE EDITING RULES:
1. Treat excludedSourceDetails as a quarantine list. No item from that list, nor a close paraphrase of its product meaning, may appear in promptZh, promptEn, mustKeep, transferGuidelines, layoutRules, componentRules, or transferablePrinciples. Keep the quarantine list itself for traceability.
2. Remove source product names, feature names, page names, tab labels, navigation destinations, exact destination counts, copied copywriting, data values, specific icon meanings, mascots, recognizable illustrations, and source business logic — even when they appear in a negative sentence such as “do not copy the original calendar.” The final prompt must not need to mention what the source contained.
3. Never translate the source information architecture into generic-sounding requirements. A visible calendar, task list, chat view, bottom navigation, floating action button, or card stack is not automatically a style invariant. Keep only transferable relationships such as hierarchy, density, grouping, alignment, rhythm, geometry, and state treatment.
4. Replace brittle absolutes with evidence-calibrated rules. Convert “all components must,” fixed pixel sizes, exact opacity, exact duration, exact navigation count, and single mandatory layouts into a token relationship, practical range, or conditional recommendation unless the draft evidence proves a repeated design-system invariant.
5. Brand or mascot imagery may survive only as an optional, replaceable illustration grammar. It can never be a mandatory subject.
6. Static screenshots do not prove motion, responsive behavior, accessibility implementation, dark mode, hover, or hidden states. Keep useful suggestions in uncertainOrInferred and phrase them as recommendations, not observations.
7. Preserve evidence-backed color relationships, typography roles, spacing rhythm, edge treatment, material strategy, component anatomy, icon drawing grammar, and density. Do not invent facts that are absent from the draft.
8. The final prompts must be reusable templates for [目标产品], [目标用户], and [页面任务] / [Target product], [Target users], and [Page task]. They must explicitly instruct the generator to create content, page sections, navigation, and information architecture from the NEW brief. Never write tautologies such as “[目标产品]为[目标产品]”. Begin naturally, for example: “请为[目标产品]的[目标用户]设计用于[页面任务]的界面。”
9. A navigation rule may describe its visual grammar only when repeated evidence supports it; placement, count, labels, order, glyph meanings, and destinations remain determined by the new product.
10. Run three silent tests before returning: source-blind test (could a reader identify the original product?), unrelated-product test (does it work for three unrelated products?), and evidence test (is every precise visual claim supported?). Repair every failure.

EXECUTABILITY RULES FOR promptZh AND promptEn:
11. The final prompt must be concrete enough to hand directly to a UI generator, but it must not prescribe the new product's business modules. Organize it in this order: target context; one-sentence visual direction; visual tokens and relationships; composition and hierarchy; typography roles; color and material roles; component and icon grammar; conditional interaction guidance; responsive and accessibility baselines; negative constraints; requested deliverables and final quality checklist.
12. Do not offer unresolved aesthetic alternatives such as “serif or sans-serif,” “paper or plastic,” “white or translucent,” or “A/B.” Select one primary direction supported by the strongest evidence. A fallback may be stated only as an implementation substitute within the same visual family.
13. Do not force navigation placement, navigation count, card layout, floating actions, page count, or a specific component family unless it is genuinely a repeated visual invariant. Say that the NEW brief determines whether those components are needed; then describe their visual treatment conditionally.
14. Never mention source-like generic modules merely to prohibit copying them. Words such as calendar, to-do, chat, statistics, dashboard, player, feed, or source navigation must not appear unless the user explicitly supplied them as part of the NEW target brief. A negative sentence still counts as leakage.
15. Avoid universal statements such as “all containers must” and avoid arbitrary exact values. Use a coherent token scale or a narrow practical range only where it improves execution and is supported by repeated evidence. Explain which elements are emphasized, restrained, layered, or allowed to break the default.
16. Use one language consistently inside each prompt. In Chinese, translate color and design terms naturally rather than mixing English labels into the prose, unless a standard technical property name is necessary.
17. “Quiet,” “warm,” “premium,” and similar mood words are not sufficient instructions. Translate them into observable decisions about contrast, saturation, density, scale, spacing rhythm, edge treatment, imagery, and emphasis.
18. Do not ask the generator to “extract” or “reuse” source modules. The receiving generator has only this prompt and the NEW brief; the prompt must stand alone without knowledge of the screenshots.

Return this exact compact JSON schema. Keep each rule array to 2–5 concise items. Do not repeat evidence, confidence, excluded details, uncertainty, motion, or naming fields because the gateway preserves those from the visual draft.
{
  "summary": "1–2 concise sentences",
  "transferablePrinciples": [],
  "transferGuidelines": [],
  "transferCheck": [],
  "coreMood": [],
  "colorRules": [],
  "typographyRules": [],
  "layoutRules": [],
  "materialRules": [],
  "componentRules": [],
  "mustKeep": [],
  "avoid": [],
  "promptZhSections": ["7–10 self-contained Chinese sections without internal line breaks"],
  "promptEnSections": ["7–10 self-contained English sections without internal line breaks"]
}

The Chinese sections together should be roughly 600–1100 Chinese characters. The English sections together should be roughly 350–650 words. Both must form complete production-ready prompts after being joined with blank lines. Read them once as if you had never seen the source: remove every phrase that refers to an original image, original module, or an unspecified aesthetic choice the generator must guess. Do not translate, rename, omit, or wrap schema keys. Do not add commentary outside JSON.`;

async function refineVisualDraft(visualAnalysis, notes, providerId, model) {
  const refinementInput = {
    task: 'source-blind transferable-style refinement',
    userNotes: notes || '',
    visualDraft: visualAnalysis
  };
  const messages = [
    { role: 'system', content: refinementSystemPrompt },
    { role: 'user', content: JSON.stringify(refinementInput) }
  ];
  let response;
  try {
    response = await callChat(providerId, model, messages, { temperature: 0.1, maxTokens: 5500, timeoutMs: 180000, responseFormat: { type: 'json_object' } });
  } catch (error) {
    if (error.status !== 400 || !/response[_ -]?format|json/i.test(error.message)) throw error;
    response = await callChat(providerId, model, messages, { temperature: 0.1, maxTokens: 5500, timeoutMs: 180000 });
  }
  try {
    const patch = selectAnalysisPayload(extractJson(response.content));
    const promptZhSections = stringArray(patch.promptZhSections);
    const promptEnSections = stringArray(patch.promptEnSections);
    const merged = { ...visualAnalysis };
    [
      'summary', 'transferablePrinciples', 'transferGuidelines', 'transferCheck',
      'coreMood', 'colorRules', 'typographyRules', 'layoutRules', 'materialRules',
      'componentRules', 'mustKeep', 'avoid'
    ].forEach(key => {
      if (Object.prototype.hasOwnProperty.call(patch, key)) merged[key] = patch[key];
    });
    if (promptZhSections.length) merged.promptZh = promptZhSections.join('\n\n');
    if (promptEnSections.length) merged.promptEn = promptEnSections.join('\n\n');
    const analysis = normalizeAnalysis(merged);
    return { response, analysis, quality: analysisQuality(analysis), parseError: '' };
  } catch (error) {
    return {
      response,
      analysis: null,
      quality: { usable: false, promptZhLength: 0, promptEnLength: 0, ruleCount: 0 },
      parseError: error.message
    };
  }
}

function pendingRefinementResult({ visualAnalysis, response, pipeline, providerId, refineProviderId = 'qwen', model, refinementUsage, refinementDuration = 0, reason }) {
  const reviewerLabel = providers[refineProviderId]?.label || refineProviderId;
  return {
    analysis: visualAnalysis,
    visualDraft: visualAnalysis,
    refinementPending: true,
    warning: `${reviewerLabel}文本复审未完成：${reason}。当前保留千问视觉草稿，可只重试文本复审，无需重新上传图片。`,
    usage: { vision: response.usage, refinement: refinementUsage || null },
    model: response.model,
    provider: providerId,
    durationMs: response.durationMs + refinementDuration,
    pipeline: [...pipeline, { role: 'refinement', provider: refineProviderId, model, durationMs: refinementDuration, status: 'failed' }]
  };
}

async function analyze(body) {
  const sourceType = String(body.sourceType || 'manual');
  const providerId = String(body.provider || 'qwen');
  const model = String(body.model || providers[providerId]?.defaultModel || '');
  const refineProviderId = String(body.refineProvider || '');
  const refineModel = String(body.refineModel || providers[refineProviderId]?.defaultModel || '');
  const notes = String(body.notes || '').slice(0, 6000);
  const name = String(body.name || '').slice(0, 160);
  const text = String(body.text || '').slice(0, 100000);
  const images = Array.isArray(body.images) ? body.images.slice(0, 4) : [];

  if (sourceType === 'figma') throw Object.assign(new Error('Figma 链接需要授权读取；当前请导出关键画板并使用“例图”上传'), { status: 400 });
  if (sourceType === 'images' && !images.length) throw Object.assign(new Error('至少需要一张例图'), { status: 400 });
  if (sourceType !== 'images' && !text.trim()) throw Object.assign(new Error('没有可分析的规则文本'), { status: 400 });

  const instruction = `Analysis mode: transferable-style-extraction\nSource type: ${sourceType}\nWorking name: ${name || 'unnamed personal style'}\nUser notes: ${notes || 'none'}\n${text ? `Source text:\n${text}` : `Analyze ${images.length} screenshot(s) from one source product. Infer the repeated visual system across screens, explicitly quarantine source-specific content, and produce a style prompt that remains useful for a completely different product.`}`;
  const content = sourceType === 'images'
    ? [{ type: 'text', text: instruction }, ...images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))]
    : instruction;
  const response = await callChat(providerId, model, [
    { role: 'system', content: analysisSystemPrompt },
    { role: 'user', content }
  ], { hasImages: sourceType === 'images', temperature: 0.15, maxTokens: 5500, timeoutMs: 240000, enableThinking: false });
  let visualAnalysis;
  try { visualAnalysis = normalizeAnalysis(extractJson(response.content)); }
  catch (error) { throw Object.assign(new Error(`千问视觉提取返回格式不完整：${error.message}`), { status: 502 }); }
  const visualQuality = analysisQuality(visualAnalysis);
  if (!visualQuality.usable) throw Object.assign(new Error('视觉模型返回的规则或 Prompt 不完整，请减少图片后重试'), { status: 502 });
  const pipeline = [{ role: sourceType === 'images' ? 'vision' : 'text', provider: providerId, model: response.model, durationMs: response.durationMs }];

  if (sourceType === 'images' && refineProviderId) {
    if (!providers[refineProviderId]) throw Object.assign(new Error('不支持的二次审校供应商'), { status: 400 });
    let refinement;
    try {
      refinement = await refineVisualDraft(visualAnalysis, notes, refineProviderId, refineModel);
    } catch (error) {
      return pendingRefinementResult({
        visualAnalysis, response, pipeline, providerId, refineProviderId, model: refineModel,
        reason: error.message
      });
    }
    const refined = refinement.response;
    pipeline.push({ role: 'refinement', provider: refineProviderId, model: refined.model, durationMs: refined.durationMs, status: refinement.quality.usable ? 'complete' : 'empty' });
    if (!refinement.quality.usable) {
      pipeline.pop();
      return pendingRefinementResult({
        visualAnalysis, response, pipeline, providerId, refineProviderId, model: refined.model,
        refinementUsage: refined.usage, refinementDuration: refined.durationMs,
        reason: refinement.parseError || '返回了空规则或空 Prompt'
      });
    }
    return {
      analysis: refinement.analysis,
      usage: { vision: response.usage, refinement: refined.usage },
      model: refined.model,
      provider: refineProviderId,
      durationMs: response.durationMs + refined.durationMs,
      pipeline
    };
  }

  return { analysis: visualAnalysis, usage: response.usage, model: response.model, provider: providerId, durationMs: response.durationMs, pipeline };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/v1/health') {
    sendJson(res, 200, { ok: true, version: APP_VERSION, providers: providerStatus(), secretStorage: secretStorageMode });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/v1/config/keys') {
    const body = await readJson(req);
    const provider = String(body.provider || '');
    const key = String(body.key || '').trim();
    if (!providers[provider]) throw Object.assign(new Error('未知供应商'), { status: 400 });
    if (key.length < 8) throw Object.assign(new Error('Key 看起来不完整'), { status: 400 });
    const previous = secrets[provider];
    secrets[provider] = key;
    try { await persistSecretSnapshot(); }
    catch (error) {
      secrets[provider] = previous;
      throw Object.assign(new Error(`Key 已连接，但安全保存失败：${error.message}`), { status: 500 });
    }
    sendJson(res, 200, { ok: true, providers: providerStatus() });
    return true;
  }
  if (req.method === 'DELETE' && url.pathname.startsWith('/v1/config/keys/')) {
    const provider = url.pathname.split('/').pop();
    if (!providers[provider]) throw Object.assign(new Error('未知供应商'), { status: 400 });
    const previous = secrets[provider];
    secrets[provider] = '';
    try { await persistSecretSnapshot(); }
    catch (error) {
      secrets[provider] = previous;
      throw Object.assign(new Error(`Key 清除失败：${error.message}`), { status: 500 });
    }
    sendJson(res, 200, { ok: true, providers: providerStatus() });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/v1/test') {
    const body = await readJson(req);
    const provider = String(body.provider || '');
    const result = await callChat(provider, body.model, [
      { role: 'system', content: 'Return only the text STYLE_STUB_OK.' },
      { role: 'user', content: 'Connection test.' }
    ], { temperature: 0, maxTokens: 512, enableThinking: false });
    if (!/STYLE_STUB_OK/i.test(result.content)) throw Object.assign(new Error(`${providers[provider]?.label || provider} 已响应，但没有返回预期烟测口令`), { status: 502 });
    sendJson(res, 200, { ok: true, provider, model: result.model, usage: result.usage });
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/v1/analyze') {
    const body = await readJson(req);
    sendJson(res, 200, await analyze(body));
    return true;
  }
  if (req.method === 'POST' && url.pathname === '/v1/refine') {
    const body = await readJson(req);
    const provider = String(body.provider || 'qwen');
    const model = String(body.model || providers[provider]?.defaultModel || '');
    const notes = String(body.notes || '').slice(0, 6000);
    const visualDraft = normalizeAnalysis(body.visualDraft);
    if (!analysisQuality(visualDraft).usable) throw Object.assign(new Error('没有可重试的千问视觉草稿'), { status: 400 });
    const refinement = await refineVisualDraft(visualDraft, notes, provider, model);
    if (!refinement.quality.usable) throw Object.assign(new Error(`${providers[provider]?.label || provider}文本复审仍未生成可用结果：${refinement.parseError || '空规则或空 Prompt'}；视觉草稿仍已保留`), { status: 502 });
    sendJson(res, 200, {
      analysis: refinement.analysis,
      provider,
      model: refinement.response.model,
      durationMs: refinement.response.durationMs,
      pipeline: [{ role: 'refinement', provider, model: refinement.response.model, durationMs: refinement.response.durationMs, status: 'complete' }]
    });
    return true;
  }
  return false;
}

function serveStatic(req, res, url) {
  const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(ROOT, `.${relative}`);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    sendJson(res, 403, { error: '禁止访问该路径' });
    return;
  }
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) { sendJson(res, 404, { error: '没有找到页面' }); return; }
    res.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function createGatewayServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    try {
      if (url.pathname.startsWith('/v1/')) {
        const handled = await handleApi(req, res, url);
        if (!handled) sendJson(res, 404, { error: '未知网关接口' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { sendJson(res, 405, { error: '不支持的请求方式' }); return; }
      serveStatic(req, res, url);
    } catch (error) {
      if (!res.headersSent) sendJson(res, error.status || 500, { error: error.message || '网关内部错误' });
    }
  });
}

function startGateway({ host = HOST, port = PORT, quiet = false, initialSecrets = {}, onSecretsChanged = null, secretStorage = 'memory-only' } = {}) {
  Object.keys(secrets).forEach(id => { secrets[id] = String(initialSecrets[id] || '').trim(); });
  persistSecrets = typeof onSecretsChanged === 'function' ? onSecretsChanged : null;
  secretStorageMode = persistSecrets ? secretStorage : 'memory-only';
  const server = createGatewayServer();
  return new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      if (!quiet) {
        console.log(`Style Stub is ready at http://${host}:${port}/`);
        console.log(secretStorageMode === 'memory-only'
          ? 'API keys are held in memory only and are cleared when this process stops.'
          : 'API keys are restored from encrypted local application storage.');
      }
      resolve(server);
    });
  });
}

if (require.main === module) {
  startGateway().catch(error => {
    console.error(`Style Stub failed to start: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { startGateway };
