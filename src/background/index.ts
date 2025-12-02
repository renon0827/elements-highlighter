// 右クリックメニューを作成
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'start-design-helper',
    title: '画面設計ヘルパーを開始',
    contexts: ['page'],
  });
});

// 右クリックメニューのクリックイベント
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'start-design-helper' && tab?.id) {
    // Content Scriptにメッセージを送信
    chrome.tabs.sendMessage(tab.id, { type: 'START_EDITING' });
  }
});

// ツールバーアイコンのクリックイベント
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'START_EDITING' });
  }
});
