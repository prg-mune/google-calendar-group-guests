const GROUPS_KEY = 'guestGroups';

const els = {
  notice: document.getElementById('notice'),
  list: document.getElementById('group-list'),
  empty: document.getElementById('empty-state'),
  form: document.getElementById('group-form'),
  formTitle: document.getElementById('form-title'),
  name: document.getElementById('group-name'),
  emails: document.getElementById('group-emails'),
  saveGroup: document.getElementById('save-group'),
  showForm: document.getElementById('show-form'),
  emptyCreate: document.getElementById('empty-create'),
  cancelForm: document.getElementById('cancel-form')
};

let groups = [];
let editingGroupId = null;

document.addEventListener('DOMContentLoaded', init);
els.showForm.addEventListener('click', () => showForm());
els.emptyCreate.addEventListener('click', () => showForm());
els.cancelForm.addEventListener('click', hideForm);
els.form.addEventListener('submit', saveGroup);

async function init() {
  try {
    groups = await loadGroups();
    render();
  } catch (error) {
    showNotice('グループ情報を読み込めませんでした。拡張機能を更新してください。', true);
  }
}

async function loadGroups() {
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

async function persistGroups() {
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

function render() {
  els.list.innerHTML = '';
  els.empty.hidden = groups.length > 0;

  groups.forEach((group) => {
    const card = document.createElement('article');
    card.className = 'group-card';

    const title = document.createElement('h2');
    title.textContent = group.name;

    const emails = document.createElement('p');
    emails.className = 'emails';
    emails.textContent = group.emails.join('\n');

    const actions = document.createElement('div');
    actions.className = 'group-actions';

    const add = document.createElement('button');
    add.className = 'primary-button';
    add.type = 'button';
    add.textContent = 'ゲストに追加';
    add.addEventListener('click', () => addGroupToCalendar(group.id));

    const edit = document.createElement('button');
    edit.className = 'secondary-button';
    edit.type = 'button';
    edit.textContent = '編集';
    edit.addEventListener('click', () => showForm(group));

    const remove = document.createElement('button');
    remove.className = 'danger-button';
    remove.type = 'button';
    remove.textContent = '削除';
    remove.addEventListener('click', () => removeGroup(group.id));

    actions.append(add, edit, remove);
    card.append(title, emails, actions);
    els.list.append(card);
  });
}

function showForm(group = null) {
  clearNotice();
  editingGroupId = group ? group.id : null;
  els.formTitle.textContent = group ? 'グループを編集' : 'グループを作成';
  els.saveGroup.textContent = group ? '更新' : '保存';
  els.name.value = group ? group.name : '';
  els.emails.value = group ? group.emails.join('\n') : '';
  els.form.hidden = false;
  els.list.hidden = true;
  els.empty.hidden = true;
  els.name.focus();
}

function hideForm() {
  clearNotice();
  els.form.reset();
  editingGroupId = null;
  els.form.hidden = true;
  els.list.hidden = false;
  els.empty.hidden = groups.length > 0;
}

async function saveGroup(event) {
  event.preventDefault();

  const name = els.name.value.trim();
  const emails = parseEmails(els.emails.value);
  const wasEditing = Boolean(editingGroupId);

  if (!name || emails.length === 0) {
    showNotice('グループ名と有効なメールアドレスを入力してください。', true);
    return;
  }

  if (wasEditing) {
    groups = groups.map((group) => group.id === editingGroupId
      ? { ...group, name, emails }
      : group);
  } else {
    groups.push({
      id: crypto.randomUUID(),
      name,
      emails
    });
  }

  try {
    await persistGroups();
  } catch (error) {
    showNotice('グループを保存できませんでした。', true);
    return;
  }

  hideForm();
  render();
  showNotice(wasEditing ? 'グループを更新しました。' : 'グループを保存しました。');
}

async function removeGroup(groupId) {
  const target = groups.find((group) => group.id === groupId);
  if (target && !window.confirm(`${target.name}を削除しますか？`)) {
    return;
  }

  groups = groups.filter((group) => group.id !== groupId);
  try {
    await persistGroups();
  } catch (error) {
    showNotice('グループを削除できませんでした。', true);
    return;
  }

  render();
  showNotice('グループを削除しました。');
}

async function addGroupToCalendar(groupId) {
  const group = groups.find((item) => item.id === groupId);
  if (!group) {
    showNotice('グループが見つかりません。', true);
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.startsWith('https://calendar.google.com/')) {
      showNotice('Googleカレンダーのタブで予定作成/編集画面を開いてから押してください。', true);
      return;
    }

    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'ADD_GUEST_GROUP',
      emails: group.emails
    });

    if (!response || !response.ok) {
      showNotice(response && response.message ? response.message : 'ゲスト欄が見つかりませんでした。', true);
      return;
    }

    showNotice(`${response.added}件のメールアドレスを入力しました。予定を保存してください。`);
  } catch (error) {
    showNotice('Googleカレンダーを再読み込みして、予定作成/編集画面で再度お試しください。', true);
  }
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

function normalizeGroups(items) {
  return items
    .filter((group) => group && typeof group.name === 'string' && Array.isArray(group.emails))
    .map((group) => ({
      id: group.id || crypto.randomUUID(),
      name: group.name.trim(),
      emails: parseEmails(group.emails.join('\n'))
    }))
    .filter((group) => group.name && group.emails.length > 0);
}

function showNotice(message, isError = false) {
  els.notice.textContent = message;
  els.notice.classList.toggle('error', isError);
  els.notice.hidden = false;
}

function clearNotice() {
  els.notice.textContent = '';
  els.notice.classList.remove('error');
  els.notice.hidden = true;
}
