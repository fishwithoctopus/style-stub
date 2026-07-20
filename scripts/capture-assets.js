const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, BrowserWindow } = require('electron');
const { startGateway } = require('../server/gateway');

const ROOT = path.resolve(__dirname, '..');
const APP_ASSETS = path.join(ROOT, 'docs', 'assets');
const XHS_ASSETS = path.join(ROOT, 'marketing', 'xiaohongshu');
const CAPTURE_PROFILE = path.join(os.tmpdir(), 'style-stub-public-capture');

function demoCover() {
  const png = fs.readFileSync(path.join(APP_ASSETS, 'catalog.png'));
  return `data:image/png;base64,${png.toString('base64')}`;
}

function demoState() {
  const promptZh = '为[目标产品]的[目标用户]设计用于[页面任务]的界面。保留安静、温和、低饱和的核心气质，以浅蓝灰背景、柔和珊瑚与长春花蓝作为低比例强调；使用宽松留白、圆润边缘、轻量边框和哑光表面建立亲近但清晰的层级。标题与正文需要有明确的字体角色，图标保持圆头细线语法。请根据新产品重新规划内容、导航与功能，不得复刻来源界面的文案、专属图标或信息架构。';
  const promptEn = 'Design an interface for [target product], [target audience] and [page task]. Preserve a quiet, warm and low-saturation mood with a pale blue-gray canvas and restrained coral and periwinkle accents. Build hierarchy through generous spacing, rounded edges, light borders and matte surfaces. Define distinct display and body typography roles and use rounded line icons. Rebuild all content, navigation and functions for the new product; do not copy source copy, product-specific icons or information architecture.';
  return {
    lab: [
      { entryId: 'editorial', strength: 70, weight: 50 },
      { entryId: 'liquid-glass', strength: 45, weight: 32 },
      { entryId: 'paper-texture', strength: 25, weight: 18 }
    ],
    personal: [{
      id: 'public-demo-style',
      origin: 'import',
      sourceType: 'images',
      name: '柔雾生活界面',
      createdAt: '2026-07-20T12:00:00.000Z',
      mood: '安静、温馨，像一张被晨光照亮的软纸。',
      summary: '从示例界面中提取的低饱和色彩、圆润几何、宽松节奏与轻线条图标语法。',
      coverImage: demoCover(),
      promptZh,
      promptEn,
      fidelity: 'balanced',
      analysisResult: {
        summary: '安静温和、低饱和且具有柔软触感的界面语言。',
        transferablePrinciples: ['低对比粉彩色建立情绪层', '圆润容器与宽松留白共同降低操作压力', '轻线条图标与克制强调色维持一致反馈'],
        coreMood: ['安静', '温馨', '轻盈'],
        colorRules: ['浅蓝灰或暖灰白作为大面积底色', '珊瑚与长春花蓝只用于关键状态'],
        typographyRules: ['标题与正文建立明确角色', '正文保持舒展行高与易读对比'],
        layoutRules: ['模块间距大于模块内间距', '业务内容根据新产品重新组织'],
        materialRules: ['哑光、轻边框、极弱弥散阴影'],
        componentRules: ['中大圆角容器', '圆头细线图标'],
        mustKeep: ['低饱和色彩关系', '柔和边缘与留白节奏'],
        avoid: ['来源产品文案与导航目的地', '高饱和霓虹色与重黑阴影'],
        excludedSourceDetails: ['产品名、业务标签、专属图标和页面顺序'],
        transferCheck: ['替换为阅读器、健康工具或旅行产品时仍然成立'],
        promptZh,
        promptEn
      }
    }]
  };
}

async function captureAppScreens(port) {
  fs.mkdirSync(APP_ASSETS, { recursive: true });
  const win = new BrowserWindow({
    width: 364,
    height: 744,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });

  const url = `http://127.0.0.1:${port}/?desktop=1&publicCapture=1`;
  await win.loadURL(url);
  const fixture = demoState();
  await win.webContents.executeJavaScript(`
    localStorage.clear();
    localStorage.setItem('style-stub.lab.v1', ${JSON.stringify(JSON.stringify(fixture.lab))});
    localStorage.setItem('style-stub.personal.v1', ${JSON.stringify(JSON.stringify(fixture.personal))});
    location.reload();
  `);
  await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
  await win.webContents.executeJavaScript(`document.documentElement.classList.add('desktop-shell')`);

  const screens = [
    ['catalog', `setRoute('catalog')`],
    ['detail', `setRoute('detail', 'bauhaus')`],
    ['lab', `setRoute('lab')`],
    ['mine', `setRoute('mine')`],
    ['personal-style', `setRoute('mineDetail', 'public-demo-style')`]
  ];

  for (const [name, action] of screens) {
    await win.webContents.executeJavaScript(`${action}; document.querySelector('#view').scrollTop = 0;`);
    await new Promise(resolve => setTimeout(resolve, 180));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(APP_ASSETS, `${name}.png`), image.toPNG());
  }
  return win;
}

async function captureXhsCards(port) {
  fs.mkdirSync(XHS_ASSETS, { recursive: true });
  const win = new BrowserWindow({
    width: 1080,
    height: 1440,
    useContentSize: true,
    frame: false,
    show: false,
    backgroundColor: '#171511',
    webPreferences: { offscreen: true, backgroundThrottling: false }
  });
  win.setContentSize(1080, 1440, false);
  const source = fs.readFileSync(path.join(XHS_ASSETS, 'cards.html'), 'utf8')
    .replaceAll('../../docs/assets/', `http://127.0.0.1:${port}/docs/assets/`);
  for (let index = 1; index <= 5; index += 1) {
    const html = source.replace("const n=new URLSearchParams(location.search).get('slide')||'1';", `const n='${index}';`);
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await win.webContents.executeJavaScript(`Promise.all([...document.images].map(image => image.decode().catch(() => null))).then(() => document.fonts.ready).then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
    await new Promise(resolve => setTimeout(resolve, 220));
    const image = await win.webContents.capturePage();
    const output = image.resize({ width: 1080, height: 1440, quality: 'best' });
    fs.writeFileSync(path.join(XHS_ASSETS, `0${index}.png`), output.toPNG());
  }
  win.destroy();
}

app.setPath('userData', CAPTURE_PROFILE);
app.whenReady().then(async () => {
  let server;
  let appCaptureWindow;
  try {
    server = await startGateway({ port: 0, quiet: true });
    appCaptureWindow = await captureAppScreens(server.address().port);
    await captureXhsCards(server.address().port);
    console.log('[Style Stub] public screenshots generated');
  } finally {
    if (appCaptureWindow && !appCaptureWindow.isDestroyed()) appCaptureWindow.destroy();
    if (server) await new Promise(resolve => server.close(resolve));
    app.quit();
  }
}).catch(error => {
  console.error(error);
  app.exit(1);
});
