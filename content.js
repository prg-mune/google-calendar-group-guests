const GROUPS_KEY = 'guestGroups';
const PANEL_ID = 'gcgg-panel';
const OBSERVER_DELAY_MS = 600;

let renderTimer = null;
let observer = null;

try {
  initInlinePanel();
} catch (error) {
  console.warn('[Calendar Group Guests] Failed to initialize:', error);
}

if (isExtensionContextValid()) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'ADD_GUEST_GROUP') {
      return false;
    }

    addGuestGroup(message.emails || [])
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, message: error.message }));

    return true;
  });
}

function initInlinePanel() {
  if (!isExtensionContextValid()) {
    return;
  }

  schedulePanelRender();
  observer = new MutationObserver((mutations) => {
    const panel = document.getElementById(PANEL_ID);
    const onlyOwnChanges = panel && mutations.every((mutation) => panel.contains(mutation.target));
    if (!onlyOwnChanges) {
      schedulePanelRender();
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (isExtensionContextValid()) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'sync' && changes[GROUPS_KEY]) {
        schedulePanelRender();
      }
    });
  }
}

function schedulePanelRender() {
  if (!isExtensionContextValid()) {
    teardownInlinePanel();
    return;
  }

  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(() => {
    renderInlinePanel().catch((error) => {
      if (!isExtensionInvalidatedError(error)) {
        console.warn('[Calendar Group Guests] Failed to render panel:', error);
      }
    });
  }, OBSERVER_DELAY_MS);
}

async function renderInlinePanel() {
  try {
    const anchor = findInlinePanelAnchor();
    if (!anchor) {
      removeInlinePanel();
      return;
    }

    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = createInlinePanel();
    }

    if (panel.parentElement !== anchor.parentElement || panel.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement('afterend', panel);
    }

    await updateInlinePanel(panel);
  } catch (error) {
    if (isExtensionInvalidatedError(error)) {
      teardownInlinePanel();
      return;
    }
    console.warn('[Calendar Group Guests] Failed to render panel:', error);
  }
}

function findInlinePanelAnchor() {
  const guestInputs = Array.from(document.querySelectorAll('input, textarea'))
    .filter(isVisible)
    .filter(isLikelyCalendarSidebarGuestInput);

  if (guestInputs.length === 0) {
    return null;
  }

  const input = guestInputs[0];
  let anchor = input.closest('[role="search"]') || input.parentElement || input;

  while (anchor.parentElement && shouldClimbOutOfSearchBox(anchor, anchor.parentElement)) {
    anchor = anchor.parentElement;
  }

  return anchor;
}

function shouldClimbOutOfSearchBox(element, parent) {
  const rect = element.getBoundingClientRect();
  const parentRect = parent.getBoundingClientRect();
  const parentStyle = window.getComputedStyle(parent);

  if (parentRect.width > 380 || parentRect.height > 300) {
    return false;
  }

  return parentStyle.display === 'flex' ||
    parentStyle.display === 'grid' ||
    Math.abs(parentRect.width - rect.width) < 80;
}

function isLikelyCalendarSidebarGuestInput(element) {
  const label = [
    element.getAttribute('aria-label'),
    element.getAttribute('placeholder'),
    element.getAttribute('title')
  ].filter(Boolean).join(' ').toLowerCase();

  return [
    'ユーザーを検索',
    'ゲスト',
    'search for people',
    'search people',
    'add guests',
    'guest'
  ].some((keyword) => label.includes(keyword.toLowerCase()));
}

function createInlinePanel() {
  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.className = 'gcgg-panel';
  panel.innerHTML = [
    '<div class="gcgg-header">',
    '  <div class="gcgg-title">ゲストグループ</div>',
    '  <button class="gcgg-add-button" type="button" title="グループを追加" aria-label="グループを追加">+</button>',
    '</div>',
    '<form class="gcgg-popover" hidden>',
    '  <label class="gcgg-label">グループ名<input class="gcgg-input" name="name" type="text" autocomplete="off" placeholder="例: 役員"></label>',
    '  <label class="gcgg-label">メールアドレス<textarea class="gcgg-textarea" name="emails" placeholder="1行に1件、またはカンマ区切り"></textarea></label>',
    '  <input name="groupId" type="hidden">',
    '  <div class="gcgg-actions">',
    '    <button class="gcgg-save-button" type="submit">保存</button>',
    '    <button class="gcgg-cancel-button" type="button">キャンセル</button>',
    '  </div>',
    '</form>',
    '<div class="gcgg-groups"></div>',
    '<p class="gcgg-empty" hidden>グループがありません。</p>',
    '<p class="gcgg-message" hidden></p>'
  ].join('');

  panel.querySelector('.gcgg-add-button').addEventListener('click', () => safelyRun(() => showInlinePopover(panel)));
  panel.querySelector('.gcgg-cancel-button').addEventListener('click', () => safelyRun(() => hideInlinePopover(panel)));
  panel.querySelector('.gcgg-popover').addEventListener('submit', (event) => safelyRun(() => saveInlineGroup(event, panel)));

  return panel;
}

async function updateInlinePanel(panel) {
  let groups = [];
  try {
    groups = await loadGroups();
  } catch (error) {
    setInlineMessage(panel, 'グループ情報を読み込めませんでした。拡張機能を更新してください。', true);
    return;
  }
  const list = panel.querySelector('.gcgg-groups');
  const empty = panel.querySelector('.gcgg-empty');
  const popover = panel.querySelector('.gcgg-popover');

  list.innerHTML = '';
  empty.hidden = groups.length > 0;
  list.hidden = groups.length === 0 || !popover.hidden;

  groups.forEach((group) => {
    const row = document.createElement('div');
    row.className = 'gcgg-group';

    const button = document.createElement('button');
    button.className = 'gcgg-group-button';
    button.type = 'button';
    button.title = `${group.name}\n${group.emails.join('\n')}`;
    button.textContent = `${group.name} (${group.emails.length})`;
    button.addEventListener('click', () => safelyRun(() => addInlineGroup(panel, group.id)));

    const edit = document.createElement('button');
    edit.className = 'gcgg-row-action gcgg-edit-button';
    edit.type = 'button';
    edit.title = '編集';
    edit.setAttribute('aria-label', `${group.name}を編集`);
    edit.textContent = '✎';
    edit.addEventListener('click', (event) => {
      event.stopPropagation();
      safelyRun(() => showInlinePopover(panel, group));
    });

    const remove = document.createElement('button');
    remove.className = 'gcgg-row-action gcgg-delete-button';
    remove.type = 'button';
    remove.title = '削除';
    remove.setAttribute('aria-label', `${group.name}を削除`);
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      safelyRun(() => deleteInlineGroup(panel, group.id));
    });

    row.append(button, edit, remove);
    list.append(row);
  });
}

function showInlinePopover(panel, group = null) {
  setInlineMessage(panel, '');
  const popover = panel.querySelector('.gcgg-popover');
  popover.elements.groupId.value = group ? group.id : '';
  popover.elements.name.value = group ? group.name : '';
  popover.elements.emails.value = group ? group.emails.join('\n') : '';
  popover.querySelector('.gcgg-save-button').textContent = group ? '更新' : '保存';
  popover.hidden = false;
  panel.querySelector('.gcgg-groups').hidden = true;
  panel.querySelector('.gcgg-empty').hidden = true;
  panel.querySelector('.gcgg-input').focus();
}

async function hideInlinePopover(panel) {
  setInlineMessage(panel, '');
  const popover = panel.querySelector('.gcgg-popover');
  popover.reset();
  popover.hidden = true;
  await updateInlinePanel(panel);
}

async function saveInlineGroup(event, panel) {
  event.preventDefault();

  const form = event.currentTarget;
  const groupId = form.elements.groupId.value;
  const name = form.elements.name.value.trim();
  const emails = parseEmails(form.elements.emails.value);

  if (!name || emails.length === 0) {
    setInlineMessage(panel, 'グループ名と有効なメールアドレスを入力してください。', true);
    return;
  }

  let groups = [];
  try {
    groups = await loadGroups();
    const nextGroups = groupId
      ? groups.map((group) => group.id === groupId ? { ...group, name, emails } : group)
      : groups.concat({ id: crypto.randomUUID(), name, emails });
    await saveGroups(nextGroups);
  } catch (error) {
    setInlineMessage(panel, 'グループを保存できませんでした。', true);
    return;
  }
  form.reset();
  form.hidden = true;
  await updateInlinePanel(panel);
  setInlineMessage(panel, groupId ? 'グループを更新しました。' : 'グループを追加しました。');
}

async function deleteInlineGroup(panel, groupId) {
  try {
    const groups = await loadGroups();
    const target = groups.find((group) => group.id === groupId);
    if (target && !window.confirm(`${target.name}を削除しますか？`)) {
      return;
    }

    const nextGroups = groups.filter((group) => group.id !== groupId);
    await saveGroups(nextGroups);
  } catch (error) {
    setInlineMessage(panel, 'グループを削除できませんでした。', true);
    return;
  }

  await updateInlinePanel(panel);
  setInlineMessage(panel, 'グループを削除しました。');
}

async function addInlineGroup(panel, groupId) {
  let group = null;
  try {
    group = (await loadGroups()).find((item) => item.id === groupId);
  } catch (error) {
    setInlineMessage(panel, 'グループ情報を読み込めませんでした。', true);
    return;
  }

  if (!group) {
    setInlineMessage(panel, 'グループが見つかりません。', true);
    return;
  }

  const response = await addGuestGroup(group.emails);
  if (!response.ok) {
    setInlineMessage(panel, response.message, true);
    return;
  }
  setInlineMessage(panel, `${response.added}件を入力しました。予定を保存してください。`);
}

function setInlineMessage(panel, message, isError = false) {
  const messageEl = panel.querySelector('.gcgg-message');
  messageEl.textContent = message;
  messageEl.hidden = !message;
  messageEl.classList.toggle('gcgg-error', isError);
}

function removeInlinePanel() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.remove();
  }
}

async function loadGroups() {
  if (!isExtensionContextValid()) {
    throw new Error('Extension context invalidated.');
  }

  const result = await chrome.storage.sync.get({ [GROUPS_KEY]: seedGroups() });
  if (!Array.isArray(result[GROUPS_KEY])) {
    return [];
  }

  return result[GROUPS_KEY]
    .filter((group) => group && typeof group.name === 'string' && Array.isArray(group.emails))
    .map((group) => ({
      id: group.id || crypto.randomUUID(),
      name: group.name,
      emails: group.emails.filter((email) => typeof email === 'string')
    }));
}

async function saveGroups(groups) {
  if (!isExtensionContextValid()) {
    throw new Error('Extension context invalidated.');
  }

  await chrome.storage.sync.set({ [GROUPS_KEY]: normalizeGroups(groups) });
}

function seedGroups() {
  return [
    {
      id: 'sample-group',
      name: 'サンプルグループ',
      emails: ['taro@example.com', 'hanako@example.com']
    }
  ];
}

function parseEmails(text) {
  const seen = new Set();
  return text
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    .filter((email) => {
      if (seen.has(email)) {
        return false;
      }
      seen.add(email);
      return true;
    });
}

function normalizeGroups(groups) {
  return groups
    .filter((group) => group && typeof group.name === 'string' && Array.isArray(group.emails))
    .map((group) => ({
      id: group.id || crypto.randomUUID(),
      name: group.name.trim(),
      emails: parseEmails(group.emails.join('\n'))
    }))
    .filter((group) => group.name && group.emails.length > 0);
}

async function addGuestGroup(emails) {
  const validEmails = emails.filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (validEmails.length === 0) {
    return { ok: false, message: '追加するメールアドレスがありません。' };
  }

  await openGuestEditorIfNeeded();

  let input = await waitForGuestInput();
  if (!input) {
    return {
      ok: false,
      message: '予定作成/編集画面のゲスト入力欄が見つかりませんでした。'
    };
  }

  for (const email of validEmails) {
    input = await enterGuest(input, email);
  }

  return { ok: true, added: validEmails.length };
}

async function openGuestEditorIfNeeded() {
  const button = findVisibleElement([
    '[aria-label*="ゲストを追加"]',
    '[aria-label*="Add guests"]',
    '[data-tooltip*="ゲストを追加"]',
    '[data-tooltip*="Add guests"]'
  ]);

  if (button) {
    button.click();
    await sleep(250);
  }
}

async function waitForGuestInput() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const input = findGuestInput();
    if (input) {
      return input;
    }
    await sleep(150);
  }
  return null;
}

function findGuestInput() {
  const candidates = Array.from(document.querySelectorAll('input, textarea'))
    .filter(isVisible)
    .filter((element) => {
      const label = [
        element.getAttribute('aria-label'),
        element.getAttribute('placeholder'),
        element.getAttribute('title')
      ].filter(Boolean).join(' ').toLowerCase();

      return [
        'ゲスト',
        'ユーザー',
        'guest',
        'guests',
        'add guests',
        'add people'
      ].some((keyword) => label.includes(keyword));
    });

  return candidates.find((element) => element.matches('input')) || candidates[0] || null;
}

async function enterGuest(input, email) {
  input.focus();
  setNativeValue(input, email);
  input.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    composed: true,
    inputType: 'insertText',
    data: email
  }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(120);

  dispatchKeyboard(input, 'Enter');
  await sleep(450);

  const freshInput = findGuestInput();
  if (freshInput && freshInput !== input) {
    input = freshInput;
  }
  input.focus();
  return input;
}

function setNativeValue(element, value) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function dispatchKeyboard(element, key) {
  const eventInit = {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    composed: true
  };
  element.dispatchEvent(new KeyboardEvent('keydown', eventInit));
  element.dispatchEvent(new KeyboardEvent('keypress', eventInit));
  element.dispatchEvent(new KeyboardEvent('keyup', eventInit));
}

function findVisibleElement(selectors) {
  for (const selector of selectors) {
    const element = Array.from(document.querySelectorAll(selector)).find(isVisible);
    if (element) {
      return element;
    }
  }
  return null;
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== 'hidden' &&
    style.display !== 'none';
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function safelyRun(callback) {
  try {
    Promise.resolve(callback()).catch((error) => {
      if (!isExtensionInvalidatedError(error)) {
        console.warn('[Calendar Group Guests] Action failed:', error);
      }
    });
  } catch (error) {
    if (!isExtensionInvalidatedError(error)) {
      console.warn('[Calendar Group Guests] Action failed:', error);
    }
  }
}

function teardownInlinePanel() {
  window.clearTimeout(renderTimer);
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  removeInlinePanel();
}

function isExtensionContextValid() {
  try {
    return Boolean(chrome && chrome.runtime && chrome.runtime.id && chrome.storage);
  } catch (error) {
    return false;
  }
}

function isExtensionInvalidatedError(error) {
  return error && String(error.message || error).includes('Extension context invalidated');
}
