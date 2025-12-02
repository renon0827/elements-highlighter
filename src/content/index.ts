import type { SelectedElement, Message, FrameColor } from '../types';
import { FRAME_COLORS } from '../types';
import html2canvas from 'html2canvas';
import './styles.css';

// 状態管理
let isEditing = false;
let selectedElements: SelectedElement[] = [];
let nextNumber = 1;
let hoveredElement: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let overlayContainer: HTMLElement | null = null;

// フォーカスモード（サブセクション編集）
let focusedElementId: string | null = null; // フォーカス中の親要素ID
let focusedSubNumber = 1; // サブセクションの連番

// localStorageのキー（URLごとに保存）
function getStorageKey(): string {
  return `wdh-state-${location.href}`;
}

// 保存データの型
interface SavedState {
  elements: SelectedElement[];
  nextNumber: number;
  focusedElementId: string | null;
  focusedSubNumber: number;
}

// 状態を保存
function saveState(): void {
  try {
    const state: SavedState = {
      elements: selectedElements,
      nextNumber: nextNumber,
      focusedElementId: focusedElementId,
      focusedSubNumber: focusedSubNumber,
    };
    localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch (e) {
    console.warn('WDH: Failed to save state', e);
  }
}

// 状態を読み込み
function loadState(): SavedState | null {
  try {
    const data = localStorage.getItem(getStorageKey());
    if (data) {
      const parsed = JSON.parse(data);
      // 古い形式との互換性
      return {
        elements: parsed.elements || [],
        nextNumber: parsed.nextNumber || 1,
        focusedElementId: parsed.focusedElementId || null,
        focusedSubNumber: parsed.focusedSubNumber || 1,
      };
    }
  } catch (e) {
    console.warn('WDH: Failed to load state', e);
  }
  return null;
}

// 状態をクリア
function clearState(): void {
  try {
    localStorage.removeItem(getStorageKey());
  } catch (e) {
    console.warn('WDH: Failed to clear state', e);
  }
}

// 色からHEXを取得
function getColorHex(color: FrameColor): string {
  return FRAME_COLORS.find(c => c.value === color)?.hex || '#ff0000';
}

// ユニークID生成
function generateId(): string {
  return `wdh-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// CSSクラス名をエスケープ（Tailwindなどの特殊文字対応）
function escapeClassName(className: string): string {
  // CSS.escapeが使えれば使用、なければ手動エスケープ
  if (typeof CSS !== 'undefined' && CSS.escape) {
    return CSS.escape(className);
  }
  // 手動エスケープ（数字開始や特殊文字をエスケープ）
  return className.replace(/([^\w-])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');
}

// CSSセレクタを生成（より一意なセレクタを生成）
function getSelector(element: HTMLElement): string {
  if (element.id) {
    // IDもエスケープが必要な場合がある
    return `#${escapeClassName(element.id)}`;
  }

  const path: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== document.body) {
    const tagName = current.tagName;
    let selector = tagName.toLowerCase();

    if (current.className && typeof current.className === 'string') {
      const classes = current.className
        .split(' ')
        .filter(c => c && !c.startsWith('wdh-'))
        .slice(0, 2);
      if (classes.length > 0) {
        // 各クラス名をエスケープ
        const escapedClasses = classes.map(c => escapeClassName(c));
        selector += `.${escapedClasses.join('.')}`;
      }
    }

    // 兄弟要素の中での位置を追加して一意性を高める
    const parent: HTMLElement | null = current.parentElement;
    if (parent) {
      const children: HTMLCollection = parent.children;
      let sameTagCount = 0;
      let position = 0;
      for (let i = 0; i < children.length; i++) {
        if (children[i].tagName === tagName) {
          sameTagCount++;
          if (children[i] === current) {
            position = sameTagCount;
          }
        }
      }
      if (sameTagCount > 1) {
        selector += `:nth-of-type(${position})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.slice(-4).join(' > ');
}

// オーバーレイコンテナを作成（bodyのmargin/paddingを打ち消す位置に配置）
function createOverlayContainer(): HTMLElement {
  const container = document.createElement('div');
  container.className = 'wdh-overlay-container';
  container.dataset.wdhOverlayContainer = 'true';

  // bodyのmargin/paddingを取得して打ち消す
  const bodyStyle = window.getComputedStyle(document.body);
  const marginTop = parseFloat(bodyStyle.marginTop) || 0;
  const marginLeft = parseFloat(bodyStyle.marginLeft) || 0;
  const paddingTop = parseFloat(bodyStyle.paddingTop) || 0;
  const paddingLeft = parseFloat(bodyStyle.paddingLeft) || 0;
  const offsetTop = -(marginTop + paddingTop);
  const offsetLeft = -(marginLeft + paddingLeft);

  // 完全なCSSリセット（TailwindCSS等の影響を排除）
  container.style.cssText = `
    all: initial !important;
    position: absolute !important;
    top: ${offsetTop}px !important;
    left: ${offsetLeft}px !important;
    width: 0 !important;
    height: 0 !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    overflow: visible !important;
    pointer-events: none !important;
    z-index: 2147483646 !important;
    transform: none !important;
    box-sizing: content-box !important;
  `;

  return container;
}

// 枠オーバーレイを作成
function createFrameOverlay(id: string, top: number, left: number, width: number, height: number, color: FrameColor, padding: number = 0): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'wdh-frame-overlay';
  frame.dataset.wdhFrame = id;

  const borderWidth = 3;
  const hex = getColorHex(color);

  // 枠の位置を計算（content-box基準：borderは外側に描画される）
  // 枠のborderが要素を囲むように、要素の位置からborderWidth + padding分外側に配置
  const frameTop = top - borderWidth - padding;
  const frameLeft = left - borderWidth - padding;
  // content-boxなので、widthとheightはborderを含まない内部サイズ
  const frameWidth = width + padding * 2;
  const frameHeight = height + padding * 2;

  // 完全なCSSリセット（TailwindCSS等の影響を排除）
  frame.style.setProperty('all', 'initial', 'important');
  frame.style.setProperty('position', 'absolute', 'important');
  frame.style.setProperty('top', `${frameTop}px`, 'important');
  frame.style.setProperty('left', `${frameLeft}px`, 'important');
  frame.style.setProperty('width', `${frameWidth}px`, 'important');
  frame.style.setProperty('height', `${frameHeight}px`, 'important');
  frame.style.setProperty('margin', '0', 'important');
  frame.style.setProperty('padding', '0', 'important');
  frame.style.setProperty('border', `${borderWidth}px solid ${hex}`, 'important');
  frame.style.setProperty('background', 'transparent', 'important');
  frame.style.setProperty('box-sizing', 'content-box', 'important');
  frame.style.setProperty('pointer-events', 'none', 'important');
  frame.style.setProperty('z-index', '2147483646', 'important');
  frame.style.setProperty('transform', 'none', 'important');

  return frame;
}

// バッジの幅を計算する共通関数
function calculateBadgeWidth(label: string): number {
  return label.length <= 2 ? 28 : Math.max(28, label.length * 10 + 12);
}

// 番号バッジを作成（固定位置でbody直下に配置）
function createNumberBadge(id: string, label: string, top: number, left: number, color: FrameColor, padding: number = 0): HTMLElement {
  const badge = document.createElement('div');
  badge.className = 'wdh-number-badge';
  badge.textContent = label;
  badge.dataset.wdhBadge = id;

  const hex = getColorHex(color);

  // ラベルの長さに応じてサイズを調整
  const badgeWidth = calculateBadgeWidth(label);
  const badgeHeight = 28;
  const frameBorderWidth = 3;

  // 枠の外側の角にバッジの中心を配置
  // 枠は要素からpadding + frameBorderWidth分外側に描画される
  // バッジの中心をその角に合わせる
  const badgeTop = top - padding - frameBorderWidth - badgeHeight / 2;
  const badgeLeft = left - padding - frameBorderWidth - badgeWidth / 2;

  // 固定位置でインラインスタイルを設定（html2canvas対応）
  // setPropertyで!importantを付けて確実に適用
  // 完全なCSSリセット（TailwindCSS等の影響を排除）
  badge.style.setProperty('all', 'initial', 'important');
  badge.style.setProperty('margin', '0', 'important');
  badge.style.setProperty('padding', '0', 'important');
  badge.style.setProperty('border', `3px solid ${hex}`, 'important');
  badge.style.setProperty('outline', 'none', 'important');
  badge.style.setProperty('transform', 'none', 'important');
  badge.style.setProperty('float', 'none', 'important');
  badge.style.setProperty('clear', 'none', 'important');
  badge.style.setProperty('inset', 'auto', 'important');

  // 位置とサイズ
  badge.style.setProperty('position', 'absolute', 'important');
  badge.style.setProperty('top', `${badgeTop}px`, 'important');
  badge.style.setProperty('left', `${badgeLeft}px`, 'important');
  badge.style.setProperty('right', 'auto', 'important');
  badge.style.setProperty('bottom', 'auto', 'important');
  badge.style.setProperty('width', `${badgeWidth}px`, 'important');
  badge.style.setProperty('height', `${badgeHeight}px`, 'important');
  badge.style.setProperty('min-width', '0', 'important');
  badge.style.setProperty('min-height', '0', 'important');
  badge.style.setProperty('max-width', 'none', 'important');
  badge.style.setProperty('max-height', 'none', 'important');

  // 外観
  badge.style.setProperty('background-color', '#ffffff', 'important');
  badge.style.setProperty('background', '#ffffff', 'important');
  badge.style.setProperty('color', hex, 'important');
  badge.style.setProperty('border-radius', '14px', 'important');
  badge.style.setProperty('box-shadow', 'none', 'important');
  badge.style.setProperty('opacity', '1', 'important');
  badge.style.setProperty('visibility', 'visible', 'important');

  // レイアウト
  badge.style.setProperty('display', 'flex', 'important');
  badge.style.setProperty('align-items', 'center', 'important');
  badge.style.setProperty('justify-content', 'center', 'important');
  badge.style.setProperty('flex-direction', 'row', 'important');
  badge.style.setProperty('flex-wrap', 'nowrap', 'important');
  badge.style.setProperty('gap', '0', 'important');

  // テキスト
  badge.style.setProperty('font-size', '14px', 'important');
  badge.style.setProperty('font-weight', 'bold', 'important');
  badge.style.setProperty('font-family', 'Arial, sans-serif', 'important');
  badge.style.setProperty('font-style', 'normal', 'important');
  badge.style.setProperty('line-height', '1', 'important');
  badge.style.setProperty('text-align', 'center', 'important');
  badge.style.setProperty('text-decoration', 'none', 'important');
  badge.style.setProperty('text-transform', 'none', 'important');
  badge.style.setProperty('letter-spacing', 'normal', 'important');
  badge.style.setProperty('white-space', 'nowrap', 'important');

  // その他
  badge.style.setProperty('z-index', '2147483647', 'important');
  badge.style.setProperty('pointer-events', 'none', 'important');
  badge.style.setProperty('box-sizing', 'content-box', 'important');
  badge.style.setProperty('overflow', 'hidden', 'important');
  badge.style.setProperty('clip', 'auto', 'important');
  badge.style.setProperty('filter', 'none', 'important');

  return badge;
}

// 保存された状態から要素を復元
function restoreElements(savedElements: SelectedElement[]): void {
  // 既に使用されているDOM要素を追跡（同じ要素に複数のバッジが付くのを防ぐ）
  const usedElements = new Set<HTMLElement>();

  savedElements.forEach(savedEl => {
    // セレクタで要素を探す
    const element = document.querySelector(savedEl.selector) as HTMLElement;
    if (!element) {
      console.warn(`WDH: Element not found for selector: ${savedEl.selector}`);
      return;
    }

    // 既に別の選択で使用されている要素はスキップ
    if (usedElements.has(element)) {
      console.warn(`WDH: Element already used, skipping: ${savedEl.selector}`);
      return;
    }

    // 既に別のIDが付与されている場合もスキップ
    if (element.dataset.wdhId && element.dataset.wdhId !== savedEl.id) {
      console.warn(`WDH: Element already has different ID, skipping: ${savedEl.selector}`);
      return;
    }

    usedElements.add(element);

    // 要素にIDを付与
    element.dataset.wdhId = savedEl.id;

    // 現在の位置を取得（ページ構造が変わっている可能性があるため）
    const rect = element.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    const left = rect.left + window.scrollX;

    // paddingのデフォルト値（古いデータとの互換性）
    const padding = savedEl.padding ?? 0;

    // 枠オーバーレイを作成
    const frame = createFrameOverlay(savedEl.id, top, left, rect.width, rect.height, savedEl.color, padding);
    overlayContainer?.appendChild(frame);

    // 番号バッジを作成
    const badge = createNumberBadge(savedEl.id, savedEl.label, top, left, savedEl.color, padding);
    overlayContainer?.appendChild(badge);

    // 位置を更新して追加
    selectedElements.push({
      ...savedEl,
      padding,
      rect: {
        top,
        left,
        width: rect.width,
        height: rect.height,
      },
    });
  });
}

// 要素の色を変更
function changeElementColor(id: string, color: FrameColor): void {
  const el = selectedElements.find(e => e.id === id);
  if (!el) return;

  el.color = color;
  const hex = getColorHex(color);

  // 枠の色を更新（overlayContainer内を検索、!importantで上書き）
  const frame = overlayContainer?.querySelector(`[data-wdh-frame="${id}"]`) as HTMLElement;
  if (frame) {
    frame.style.setProperty('border', `3px solid ${hex}`, 'important');
  }

  // バッジの色を更新（overlayContainer内を検索、!importantで上書き）
  const badge = overlayContainer?.querySelector(`[data-wdh-badge="${id}"]`) as HTMLElement;
  if (badge) {
    badge.style.setProperty('color', hex, 'important');
    badge.style.setProperty('border', `3px solid ${hex}`, 'important');
  }

  // パネルの番号バッジも更新
  updatePanel();
  saveState();
}

// オーバーレイ（枠とバッジ）の位置を更新
function updateOverlayPositions(): void {
  selectedElements.forEach(el => {
    const element = document.querySelector(`[data-wdh-id="${el.id}"]`) as HTMLElement;
    const frame = overlayContainer?.querySelector(`[data-wdh-frame="${el.id}"]`) as HTMLElement;
    const badge = overlayContainer?.querySelector(`[data-wdh-badge="${el.id}"]`) as HTMLElement;

    if (element && frame && badge) {
      const rect = element.getBoundingClientRect();
      // オーバーレイコンテナがbodyのmargin/paddingを打ち消しているため、単純な計算でOK
      const top = rect.top + window.scrollY;
      const left = rect.left + window.scrollX;
      const borderWidth = 3;
      const padding = el.padding ?? 0;

      // 枠の位置更新（content-box基準）
      const frameTop = top - borderWidth - padding;
      const frameLeft = left - borderWidth - padding;
      frame.style.setProperty('top', `${frameTop}px`, 'important');
      frame.style.setProperty('left', `${frameLeft}px`, 'important');
      frame.style.setProperty('width', `${rect.width + padding * 2}px`, 'important');
      frame.style.setProperty('height', `${rect.height + padding * 2}px`, 'important');

      // バッジの位置更新（枠の外側角にバッジの中心を配置）
      const badgeWidth = calculateBadgeWidth(el.label);
      const badgeHeight = 28;
      badge.style.setProperty('top', `${top - padding - borderWidth - badgeHeight / 2}px`, 'important');
      badge.style.setProperty('left', `${left - padding - borderWidth - badgeWidth / 2}px`, 'important');
      badge.style.setProperty('width', `${badgeWidth}px`, 'important');

      // 状態も更新
      el.rect = {
        top,
        left,
        width: rect.width,
        height: rect.height,
      };
    }
  });
}

// 要素を選択
function selectElement(element: HTMLElement): void {
  // 既に選択されている場合は無視
  if (element.dataset.wdhId) {
    return;
  }

  // パネルやオーバーレイコンテナは選択不可
  if (element.closest('.wdh-panel') || element.closest('.wdh-overlay-container')) {
    return;
  }

  // フォーカスモード時は、フォーカス中の要素の子孫のみ選択可能
  if (focusedElementId) {
    const focusedElement = document.querySelector(`[data-wdh-id="${focusedElementId}"]`);
    if (focusedElement && !focusedElement.contains(element)) {
      return; // フォーカス要素外はクリック無効
    }
  }

  const id = generateId();

  // フォーカスモード時は「親ラベル-連番」形式
  let label: string;
  let parentId: string | null = null;

  if (focusedElementId) {
    const parentElement = selectedElements.find(e => e.id === focusedElementId);
    if (parentElement) {
      label = `${parentElement.label}-${focusedSubNumber++}`;
      parentId = focusedElementId;
    } else {
      label = String(nextNumber++);
    }
  } else {
    label = String(nextNumber++);
  }

  const color: FrameColor = 'red'; // デフォルトは赤
  const padding = 0; // デフォルトの余白

  // 要素にIDを付与
  element.dataset.wdhId = id;

  // 要素の位置を取得（オーバーレイコンテナがbodyのmargin/paddingを打ち消しているため単純計算でOK）
  const rect = element.getBoundingClientRect();
  const top = rect.top + window.scrollY;
  const left = rect.left + window.scrollX;

  // 枠オーバーレイを作成してコンテナに追加
  const frame = createFrameOverlay(id, top, left, rect.width, rect.height, color, padding);
  overlayContainer?.appendChild(frame);

  // 番号バッジを作成してコンテナに追加
  const badge = createNumberBadge(id, label, top, left, color, padding);
  overlayContainer?.appendChild(badge);

  const selectedElement: SelectedElement = {
    id,
    label,
    parentId,
    selector: getSelector(element),
    tagName: element.tagName.toLowerCase(),
    color,
    padding,
    rect: {
      top,
      left,
      width: rect.width,
      height: rect.height,
    },
  };

  selectedElements.push(selectedElement);
  updatePanel();
  saveState();
}

// 要素の選択を解除
function deselectElement(id: string): void {
  const element = document.querySelector(`[data-wdh-id="${id}"]`) as HTMLElement;
  if (element) {
    delete element.dataset.wdhId;
  }

  // 枠とバッジを削除（コンテナから）
  const frame = overlayContainer?.querySelector(`[data-wdh-frame="${id}"]`);
  if (frame) {
    frame.remove();
  }

  const badge = overlayContainer?.querySelector(`[data-wdh-badge="${id}"]`);
  if (badge) {
    badge.remove();
  }

  selectedElements = selectedElements.filter(e => e.id !== id);
  updatePanel();
  saveState();
}

// ラベルを更新
function updateLabel(id: string, label: string): void {
  const element = selectedElements.find(e => e.id === id);
  if (!element) return;

  element.label = label;

  // バッジのテキストとサイズを更新
  const badge = overlayContainer?.querySelector(`[data-wdh-badge="${id}"]`) as HTMLElement;
  if (badge) {
    badge.textContent = label;
    // サイズを再計算
    const badgeWidth = calculateBadgeWidth(label);
    const padding = element.padding ?? 0;
    const borderWidth = 3;
    badge.style.setProperty('width', `${badgeWidth}px`, 'important');
    badge.style.setProperty('left', `${element.rect.left - padding - borderWidth - badgeWidth / 2}px`, 'important');
  }
  saveState();
}

// パディングを更新
function updatePadding(id: string, padding: number): void {
  const el = selectedElements.find(e => e.id === id);
  if (!el) return;

  el.padding = padding;
  const borderWidth = 3;

  // 枠のサイズを更新
  const frameTop = el.rect.top - borderWidth - padding;
  const frameLeft = el.rect.left - borderWidth - padding;
  const frame = overlayContainer?.querySelector(`[data-wdh-frame="${id}"]`) as HTMLElement;
  if (frame) {
    frame.style.setProperty('top', `${frameTop}px`, 'important');
    frame.style.setProperty('left', `${frameLeft}px`, 'important');
    frame.style.setProperty('width', `${el.rect.width + borderWidth * 2 + padding * 2}px`, 'important');
    frame.style.setProperty('height', `${el.rect.height + borderWidth * 2 + padding * 2}px`, 'important');
  }

  // バッジの位置を更新（枠の外側角にバッジの中心を配置）
  const badge = overlayContainer?.querySelector(`[data-wdh-badge="${id}"]`) as HTMLElement;
  if (badge) {
    const badgeWidth = calculateBadgeWidth(el.label);
    const badgeHeight = 28;
    badge.style.setProperty('top', `${el.rect.top - padding - borderWidth - badgeHeight / 2}px`, 'important');
    badge.style.setProperty('left', `${el.rect.left - padding - borderWidth - badgeWidth / 2}px`, 'important');
    badge.style.setProperty('width', `${badgeWidth}px`, 'important');
  }

  saveState();
}

// 要素までスクロール
function scrollToElement(id: string): void {
  const element = document.querySelector(`[data-wdh-id="${id}"]`) as HTMLElement;
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// フォーカスモードを開始（サブセクション編集）
function startFocus(id: string): void {
  const element = selectedElements.find(e => e.id === id);
  if (!element) return;

  focusedElementId = id;

  // 既存のサブ要素から最大番号を取得して次の番号を決定
  const subElements = selectedElements.filter(e => e.parentId === id);
  const maxSubNumber = subElements.reduce((max, el) => {
    // "1-2" のような形式から最後の数字を取得
    const match = el.label.match(/-(\d+)$/);
    if (match) {
      return Math.max(max, parseInt(match[1], 10));
    }
    return max;
  }, 0);
  focusedSubNumber = maxSubNumber + 1;

  // フォーカス中の要素にスクロール
  scrollToElement(id);

  // 要素を強調表示
  const domElement = document.querySelector(`[data-wdh-id="${id}"]`) as HTMLElement;
  if (domElement) {
    domElement.classList.add('wdh-focused-element');
  }

  updatePanel();
  saveState();
}

// フォーカスモードを終了
function endFocus(): void {
  if (focusedElementId) {
    const domElement = document.querySelector(`[data-wdh-id="${focusedElementId}"]`) as HTMLElement;
    if (domElement) {
      domElement.classList.remove('wdh-focused-element');
    }
  }

  focusedElementId = null;
  focusedSubNumber = 1;

  updatePanel();
  saveState();
}

// パネルを作成
function createPanel(): HTMLElement {
  const panelEl = document.createElement('div');
  panelEl.className = 'wdh-panel';
  // 初期位置を設定
  panelEl.style.setProperty('top', '20px', 'important');
  panelEl.style.setProperty('right', '20px', 'important');
  panelEl.innerHTML = `
    <div class="wdh-panel-header">
      <h3 class="wdh-panel-title">画面設計ヘルパー</h3>
      <button class="wdh-panel-close" data-action="close">&times;</button>
    </div>
    <div class="wdh-panel-content">
      <div class="wdh-element-list-container"></div>
    </div>
    <div class="wdh-panel-actions">
      <button class="wdh-btn wdh-btn-primary" data-action="export">PNG出力</button>
      <button class="wdh-btn wdh-btn-primary" data-action="copy">コピー</button>
      <button class="wdh-btn wdh-btn-danger" data-action="clear">クリア</button>
    </div>
  `;

  // イベントリスナー
  panelEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const action = target.dataset.action || target.closest('[data-action]')?.getAttribute('data-action');

    // 入力欄クリック時は何もしない
    if (target.tagName === 'INPUT') {
      return;
    }

    if (action === 'close') {
      stopEditing();
    } else if (action === 'export') {
      exportImage();
    } else if (action === 'copy') {
      copyImageToClipboard();
    } else if (action === 'clear') {
      clearAllSelections();
    } else if (action === 'remove') {
      const id = target.dataset.id;
      if (id) {
        deselectElement(id);
      }
    } else if (action === 'color') {
      const id = target.dataset.id;
      const color = target.dataset.color as FrameColor;
      if (id && color) {
        changeElementColor(id, color);
      }
    } else if (action === 'scroll') {
      const scrollTarget = target.closest('[data-action="scroll"]') as HTMLElement;
      const id = scrollTarget?.dataset.id;
      if (id) {
        scrollToElement(id);
      }
    } else if (action === 'focus') {
      const id = target.dataset.id;
      if (id) {
        startFocus(id);
      }
    } else if (action === 'end-focus') {
      endFocus();
    }
  });

  panelEl.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('wdh-element-label')) {
      const id = target.dataset.id;
      if (id) {
        updateLabel(id, target.value);
      }
    } else if (target.classList.contains('wdh-padding-input')) {
      const id = target.dataset.id;
      if (id) {
        const padding = parseInt(target.value, 10) || 0;
        updatePadding(id, padding);
      }
    }
  });

  // ドラッグ機能
  const header = panelEl.querySelector('.wdh-panel-header') as HTMLElement;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    // 閉じるボタンや戻るボタンのクリックは除外
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    isDragging = true;
    const rect = panelEl.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    header.style.cursor = 'grabbing';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const x = e.clientX - dragOffsetX;
    const y = e.clientY - dragOffsetY;

    // 画面外に出ないように制限
    const maxX = window.innerWidth - panelEl.offsetWidth;
    const maxY = window.innerHeight - panelEl.offsetHeight;

    panelEl.style.setProperty('left', `${Math.max(0, Math.min(x, maxX))}px`, 'important');
    panelEl.style.setProperty('top', `${Math.max(0, Math.min(y, maxY))}px`, 'important');
    panelEl.style.setProperty('right', 'auto', 'important');
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      header.style.cursor = '';
    }
  });

  return panelEl;
}

// パネルを更新
function updatePanel(): void {
  if (!panel) return;

  const container = panel.querySelector('.wdh-element-list-container');
  if (!container) return;

  // パネルタイトルを更新
  const titleEl = panel.querySelector('.wdh-panel-title');
  if (titleEl) {
    if (focusedElementId) {
      const focusedEl = selectedElements.find(e => e.id === focusedElementId);
      titleEl.textContent = `サブセクション編集: ${focusedEl?.label || ''}`;
    } else {
      titleEl.textContent = '画面設計ヘルパー';
    }
  }

  // フォーカスモード時は戻るボタンを表示
  const headerEl = panel.querySelector('.wdh-panel-header');
  const existingBackBtn = headerEl?.querySelector('.wdh-back-btn');
  if (focusedElementId && !existingBackBtn && headerEl) {
    const backBtn = document.createElement('button');
    backBtn.className = 'wdh-back-btn';
    backBtn.dataset.action = 'end-focus';
    backBtn.textContent = '← 戻る';
    headerEl.insertBefore(backBtn, headerEl.firstChild);
  } else if (!focusedElementId && existingBackBtn) {
    existingBackBtn.remove();
  }

  // フォーカスモード時は該当する要素のみ表示
  let elementsToShow: SelectedElement[];
  if (focusedElementId) {
    // フォーカス中の親要素とその子要素を表示
    elementsToShow = selectedElements.filter(
      e => e.id === focusedElementId || e.parentId === focusedElementId
    );
  } else {
    // 通常モード: 親を持たない要素のみ表示
    elementsToShow = selectedElements.filter(e => e.parentId === null);
  }

  if (elementsToShow.length === 0) {
    if (focusedElementId) {
      container.innerHTML = `
        <p class="wdh-empty-message">
          要素内をクリックして<br>サブ要素を選択してください
        </p>
      `;
    } else {
      container.innerHTML = `
        <p class="wdh-empty-message">
          ページ上の要素をクリックして<br>選択してください
        </p>
      `;
    }
    return;
  }

  const listHtml = elementsToShow.map(el => {
    const hex = getColorHex(el.color);
    const colorButtons = FRAME_COLORS.map(c => `
      <button
        class="wdh-color-btn ${c.value === el.color ? 'wdh-color-btn-active' : ''}"
        data-action="color"
        data-id="${el.id}"
        data-color="${c.value}"
        style="background-color: ${c.hex};"
        title="${c.label}"
      ></button>
    `).join('');

    // フォーカスボタン: 通常モードかつ親要素のみ
    const isFocusable = !focusedElementId && el.parentId === null;
    const focusBtn = isFocusable
      ? `<button class="wdh-focus-btn" data-action="focus" data-id="${el.id}" title="サブセクション編集">▶</button>`
      : '';

    // 現在フォーカス中の親要素かどうか
    const isFocusedParent = el.id === focusedElementId;

    const currentPadding = el.padding ?? 0;

    return `
      <li class="wdh-element-item wdh-clickable ${isFocusedParent ? 'wdh-focused-parent' : ''}" data-action="scroll" data-id="${el.id}">
        <div class="wdh-element-header">
          <input
            type="text"
            class="wdh-element-label"
            data-id="${el.id}"
            value="${el.label}"
            style="color: ${hex}; border-color: ${hex};"
          />
          <span class="wdh-element-tag">&lt;${el.tagName}&gt;</span>
          ${focusBtn}
          <button class="wdh-element-remove" data-action="remove" data-id="${el.id}">&times;</button>
        </div>
        <div class="wdh-controls-row">
          <div class="wdh-color-picker">
            ${colorButtons}
          </div>
          <div class="wdh-padding-control">
            <label class="wdh-padding-label">余白:</label>
            <input
              type="number"
              class="wdh-padding-input"
              data-id="${el.id}"
              value="${currentPadding}"
              min="0"
              max="50"
            />
            <span class="wdh-padding-unit">px</span>
          </div>
        </div>
      </li>
    `;
  }).join('');

  container.innerHTML = `<ul class="wdh-element-list">${listHtml}</ul>`;
}

// 選択をクリア（フォーカスモード時はサブ要素のみ、通常時は全て）
function clearAllSelections(): void {
  if (focusedElementId) {
    // フォーカスモード時: サブ要素のみクリア
    const subElements = selectedElements.filter(e => e.parentId === focusedElementId);
    subElements.forEach(el => {
      const element = document.querySelector(`[data-wdh-id="${el.id}"]`) as HTMLElement;
      if (element) {
        delete element.dataset.wdhId;
      }
      const frame = overlayContainer?.querySelector(`[data-wdh-frame="${el.id}"]`);
      if (frame) frame.remove();
      const badge = overlayContainer?.querySelector(`[data-wdh-badge="${el.id}"]`);
      if (badge) badge.remove();
    });
    // サブ要素を配列から削除
    selectedElements = selectedElements.filter(e => e.parentId !== focusedElementId);
    focusedSubNumber = 1;
    updatePanel();
    saveState();
  } else {
    // 通常モード: 全てクリア
    const ids = selectedElements.map(e => e.id);
    ids.forEach(id => {
      const element = document.querySelector(`[data-wdh-id="${id}"]`) as HTMLElement;
      if (element) {
        delete element.dataset.wdhId;
      }
      const frame = overlayContainer?.querySelector(`[data-wdh-frame="${id}"]`);
      if (frame) frame.remove();
      const badge = overlayContainer?.querySelector(`[data-wdh-badge="${id}"]`);
      if (badge) badge.remove();
    });
    selectedElements = [];
    nextNumber = 1;
    focusedElementId = null;
    focusedSubNumber = 1;
    updatePanel();
    clearState();
  }
}

// 画像を出力
async function exportImage(): Promise<void> {
  if (!panel) return;

  // ローディングオーバーレイを表示
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'wdh-overlay';
  loadingOverlay.innerHTML = '<div class="wdh-overlay-text">画像を生成中...</div>';
  document.body.appendChild(loadingOverlay);

  // パネルを一時的に非表示
  panel.style.display = 'none';

  // Tailwind CSS対策: html2canvasでテキストがずれる問題を修正
  // https://stackoverflow.com/questions/74980740/html2canvas-shifting-text-downwards
  const tailwindFixStyle = document.createElement('style');
  tailwindFixStyle.id = 'wdh-tailwind-fix';
  tailwindFixStyle.textContent = `
    img {
      display: inline-block !important;
    }
    * {
      line-height: normal !important;
    }
  `;
  document.head.appendChild(tailwindFixStyle);

  try {
    // スクロール位置を保存
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // スクロールを一番上に移動
    window.scrollTo(0, 0);

    // オーバーレイ位置を更新
    updateOverlayPositions();

    // スタイル適用とレイアウト再計算のため少し待つ
    await new Promise(resolve => setTimeout(resolve, 100));

    let canvas: HTMLCanvasElement;
    let filename: string;

    const body = document.body;
    const html = document.documentElement;
    const fullWidth = Math.max(body.scrollWidth, html.scrollWidth);
    const fullHeight = Math.max(body.scrollHeight, html.scrollHeight);

    if (focusedElementId) {
      // フォーカスモード時: フォーカス要素のみをキャプチャ
      const focusedElement = document.querySelector(`[data-wdh-id="${focusedElementId}"]`) as HTMLElement;
      const focusedData = selectedElements.find(e => e.id === focusedElementId);

      if (!focusedElement || !focusedData) {
        throw new Error('フォーカス要素が見つかりません');
      }

      // フォーカス要素（親）の枠とバッジを一時的に非表示
      const parentFrame = overlayContainer?.querySelector(`[data-wdh-frame="${focusedElementId}"]`) as HTMLElement;
      const parentBadge = overlayContainer?.querySelector(`[data-wdh-badge="${focusedElementId}"]`) as HTMLElement;
      if (parentFrame) parentFrame.style.display = 'none';
      if (parentBadge) parentBadge.style.display = 'none';

      // フォーカス要素の位置とサイズを取得
      const padding = focusedData.padding ?? 0;
      const rect = focusedElement.getBoundingClientRect();
      const borderWidth = 3;
      const badgeMargin = 20;
      const captureX = rect.left - padding - borderWidth - badgeMargin;
      const captureY = rect.top - padding - borderWidth - badgeMargin;
      const captureWidth = rect.width + padding * 2 + borderWidth * 2 + badgeMargin * 2;
      const captureHeight = rect.height + padding * 2 + borderWidth * 2 + badgeMargin * 2;

      // html2canvasでページ全体をキャプチャしてからクロップ
      const fullCanvas = await html2canvas(document.body, {
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        allowTaint: true,
        logging: false,
        ignoreElements: (element) => {
          return element.classList.contains('wdh-overlay') ||
                 element.classList.contains('wdh-panel');
        },
      });

      // 親の枠とバッジを再表示
      if (parentFrame) parentFrame.style.display = '';
      if (parentBadge) parentBadge.style.display = '';

      // 必要な領域だけ切り出し
      canvas = document.createElement('canvas');
      canvas.width = captureWidth;
      canvas.height = captureHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          fullCanvas,
          captureX, captureY, captureWidth, captureHeight,
          0, 0, captureWidth, captureHeight
        );
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      filename = `design-spec-${focusedData.label}-${timestamp}.png`;
    } else {
      // 通常モード: ページ全体をキャプチャ
      canvas = await html2canvas(document.body, {
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        allowTaint: true,
        logging: false,
        ignoreElements: (element) => {
          return element.classList.contains('wdh-overlay') ||
                 element.classList.contains('wdh-panel');
        },
      });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      filename = `design-spec-${timestamp}.png`;
    }

    // スクロール位置を復元
    window.scrollTo(scrollX, scrollY);
    updateOverlayPositions();

    // ダウンロード
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();

  } catch (error) {
    console.error('画像の生成に失敗しました:', error);
    alert('画像の生成に失敗しました。');
  } finally {
    // Tailwind CSS対策のスタイルを削除
    tailwindFixStyle.remove();

    // パネルを再表示
    if (panel) {
      panel.style.display = '';
    }
    loadingOverlay.remove();
  }
}


async function copyImageToClipboard(): Promise<void> {
  if (!panel) return;

  // ローディングオーバーレイを表示
  const loadingOverlay = document.createElement('div');
  loadingOverlay.className = 'wdh-overlay';
  loadingOverlay.innerHTML = '<div class="wdh-overlay-text">画像を生成中...</div>';
  document.body.appendChild(loadingOverlay);

  // パネルを一時的に非表示
  panel.style.display = 'none';

  // Tailwind CSS対策: html2canvasでテキストがずれる問題を修正
  const tailwindFixStyle = document.createElement('style');
  tailwindFixStyle.id = 'wdh-tailwind-fix';
  tailwindFixStyle.textContent = `
    img {
      display: inline-block !important;
    }
    * {
      line-height: normal !important;
    }
  `;
  document.head.appendChild(tailwindFixStyle);

  try {
    // スクロール位置を保存
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // スクロールを一番上に移動
    window.scrollTo(0, 0);

    // オーバーレイ位置を更新
    updateOverlayPositions();

    // スタイル適用とレイアウト再計算のため少し待つ
    await new Promise(resolve => setTimeout(resolve, 100));

    let canvas: HTMLCanvasElement;

    const body = document.body;
    const html = document.documentElement;
    const fullWidth = Math.max(body.scrollWidth, html.scrollWidth);
    const fullHeight = Math.max(body.scrollHeight, html.scrollHeight);

    if (focusedElementId) {
      // フォーカスモード時: フォーカス要素のみをキャプチャ
      const focusedElement = document.querySelector(`[data-wdh-id="${focusedElementId}"]`) as HTMLElement;
      const focusedData = selectedElements.find(e => e.id === focusedElementId);

      if (!focusedElement || !focusedData) {
        throw new Error('フォーカス要素が見つかりません');
      }

      // フォーカス要素（親）の枠とバッジを一時的に非表示
      const parentFrame = overlayContainer?.querySelector(`[data-wdh-frame="${focusedElementId}"]`) as HTMLElement;
      const parentBadge = overlayContainer?.querySelector(`[data-wdh-badge="${focusedElementId}"]`) as HTMLElement;
      if (parentFrame) parentFrame.style.display = 'none';
      if (parentBadge) parentBadge.style.display = 'none';

      // フォーカス要素の位置とサイズを取得
      const padding = focusedData.padding ?? 0;
      const rect = focusedElement.getBoundingClientRect();
      const borderWidth = 3;
      const badgeMargin = 20;
      const captureX = rect.left - padding - borderWidth - badgeMargin;
      const captureY = rect.top - padding - borderWidth - badgeMargin;
      const captureWidth = rect.width + padding * 2 + borderWidth * 2 + badgeMargin * 2;
      const captureHeight = rect.height + padding * 2 + borderWidth * 2 + badgeMargin * 2;

      // html2canvasでページ全体をキャプチャしてからクロップ
      const fullCanvas = await html2canvas(document.body, {
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        allowTaint: true,
        logging: false,
        ignoreElements: (element) => {
          return element.classList.contains('wdh-overlay') ||
                 element.classList.contains('wdh-panel');
        },
      });

      // 親の枠とバッジを再表示
      if (parentFrame) parentFrame.style.display = '';
      if (parentBadge) parentBadge.style.display = '';

      // 必要な領域だけ切り出し
      canvas = document.createElement('canvas');
      canvas.width = captureWidth;
      canvas.height = captureHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          fullCanvas,
          captureX, captureY, captureWidth, captureHeight,
          0, 0, captureWidth, captureHeight
        );
      }
    } else {
      // 通常モード: ページ全体をキャプチャ
      canvas = await html2canvas(document.body, {
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        useCORS: true,
        allowTaint: true,
        logging: false,
        ignoreElements: (element) => {
          return element.classList.contains('wdh-overlay') ||
                 element.classList.contains('wdh-panel');
        },
      });
    }

    // スクロール位置を復元
    window.scrollTo(scrollX, scrollY);
    updateOverlayPositions();

    // クリップボードにコピー
    canvas.toBlob(async (blob) => {
      if (!blob) {
        alert('画像の生成に失敗しました。');
        return;
      }
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        // 成功メッセージを表示
        showToast('クリップボードにコピーしました');
      } catch (err) {
        console.error('クリップボードへのコピーに失敗しました:', err);
        alert('クリップボードへのコピーに失敗しました。');
      }
    }, 'image/png');

  } catch (error) {
    console.error('画像の生成に失敗しました:', error);
    alert('画像の生成に失敗しました。');
  } finally {
    // Tailwind CSS対策のスタイルを削除
    tailwindFixStyle.remove();

    // パネルを再表示
    if (panel) {
      panel.style.display = '';
    }
    loadingOverlay.remove();
  }
}

function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.className = 'wdh-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  // アニメーション後に削除
  setTimeout(() => {
    toast.classList.add('wdh-toast-fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// スクロール・リサイズ時にオーバーレイ位置を更新
function handleScrollOrResize(): void {
  if (isEditing && selectedElements.length > 0) {
    updateOverlayPositions();
  }
}

// 編集モードを開始
function startEditing(): void {
  if (isEditing) return;

  isEditing = true;
  document.body.classList.add('wdh-editing-mode');

  // オーバーレイコンテナを作成
  overlayContainer = createOverlayContainer();
  document.body.appendChild(overlayContainer);

  // 保存された状態を復元
  const savedState = loadState();
  if (savedState && savedState.elements.length > 0) {
    focusedElementId = savedState.focusedElementId;
    restoreElements(savedState.elements);

    // 次の番号を既存要素から計算（親要素のみ対象）
    const parentElements = selectedElements.filter(e => e.parentId === null);
    const maxNumber = parentElements.reduce((max, el) => {
      const num = parseInt(el.label, 10);
      return !isNaN(num) ? Math.max(max, num) : max;
    }, 0);
    nextNumber = maxNumber + 1;

    // サブ番号を既存要素から計算（フォーカス中の場合）
    if (focusedElementId) {
      const subElements = selectedElements.filter(e => e.parentId === focusedElementId);
      const maxSubNumber = subElements.reduce((max, el) => {
        // "1-2" のような形式から最後の数字を取得
        const match = el.label.match(/-(\d+)$/);
        if (match) {
          return Math.max(max, parseInt(match[1], 10));
        }
        return max;
      }, 0);
      focusedSubNumber = maxSubNumber + 1;

      // フォーカス中の要素を強調表示
      const focusedDomElement = document.querySelector(`[data-wdh-id="${focusedElementId}"]`) as HTMLElement;
      if (focusedDomElement) {
        focusedDomElement.classList.add('wdh-focused-element');
      }
    } else {
      focusedSubNumber = 1;
    }
  }

  // パネルを作成
  panel = createPanel();
  document.body.appendChild(panel);
  updatePanel();

  // イベントリスナーを追加
  document.addEventListener('mouseover', handleMouseOver);
  document.addEventListener('mouseout', handleMouseOut);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown);
  window.addEventListener('scroll', handleScrollOrResize, true);
  window.addEventListener('resize', handleScrollOrResize);
}

// 編集モードを終了
function stopEditing(): void {
  if (!isEditing) return;

  isEditing = false;
  document.body.classList.remove('wdh-editing-mode');

  // フォーカス中の要素の強調表示を解除
  if (focusedElementId) {
    const focusedDomElement = document.querySelector(`[data-wdh-id="${focusedElementId}"]`) as HTMLElement;
    if (focusedDomElement) {
      focusedDomElement.classList.remove('wdh-focused-element');
    }
    focusedElementId = null;
    focusedSubNumber = 1;
  }

  // パネルを削除
  if (panel) {
    panel.remove();
    panel = null;
  }

  // 要素のdata属性をクリア（状態はlocalStorageに保存済み）
  selectedElements.forEach(el => {
    const element = document.querySelector(`[data-wdh-id="${el.id}"]`) as HTMLElement;
    if (element) {
      delete element.dataset.wdhId;
    }
  });
  selectedElements = [];

  // オーバーレイコンテナを削除
  if (overlayContainer) {
    overlayContainer.remove();
    overlayContainer = null;
  }

  // イベントリスナーを削除
  document.removeEventListener('mouseover', handleMouseOver);
  document.removeEventListener('mouseout', handleMouseOut);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown);
  window.removeEventListener('scroll', handleScrollOrResize, true);
  window.removeEventListener('resize', handleScrollOrResize);
}

// マウスオーバーハンドラ
function handleMouseOver(e: MouseEvent): void {
  const target = e.target as HTMLElement;

  if (!isEditing || target.closest('.wdh-panel') || target.closest('.wdh-overlay-container')) {
    return;
  }

  if (hoveredElement) {
    hoveredElement.classList.remove('wdh-hover-highlight');
  }

  hoveredElement = target;
  target.classList.add('wdh-hover-highlight');
}

// マウスアウトハンドラ
function handleMouseOut(e: MouseEvent): void {
  const target = e.target as HTMLElement;
  target.classList.remove('wdh-hover-highlight');

  if (hoveredElement === target) {
    hoveredElement = null;
  }
}

// クリックハンドラ
function handleClick(e: MouseEvent): void {
  if (!isEditing) return;

  const target = e.target as HTMLElement;

  // パネル内やオーバーレイコンテナのクリックは無視
  if (target.closest('.wdh-panel') || target.closest('.wdh-overlay-container')) {
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  // ホバーハイライトを削除
  target.classList.remove('wdh-hover-highlight');

  selectElement(target);
}

// キーダウンハンドラ
function handleKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && isEditing) {
    stopEditing();
  }
}

// メッセージリスナー
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  switch (message.type) {
    case 'START_EDITING':
      startEditing();
      sendResponse({ success: true });
      break;
    case 'STOP_EDITING':
      stopEditing();
      sendResponse({ success: true });
      break;
    case 'GET_STATE':
      sendResponse({ isEditing, elements: selectedElements });
      break;
  }
  return true;
});
