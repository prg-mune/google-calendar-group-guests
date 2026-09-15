const GROUPS_PROPERTY_KEY = 'calendar_guest_groups_v1';

function onHomepage(e) {
  return buildGroupListCard(e, false);
}

function onCalendarEventOpen(e) {
  return buildGroupListCard(e, true);
}

function buildGroupListCard(e, isEventOpen) {
  const groups = getGroups_();
  const builder = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('ゲストグループ'));

  const intro = CardService.newCardSection()
    .addWidget(CardService.newTextParagraph().setText(
      isEventOpen
        ? 'グループを選ぶと、この予定のゲスト欄にメンバーを追加します。'
        : '予定作成/編集画面を開くと、グループをゲストへ追加できます。'
    ));

  const createAction = CardService.newAction()
    .setFunctionName('showGroupForm')
    .setParameters({ isEventOpen: String(isEventOpen) });
  intro.addWidget(CardService.newTextButton()
    .setText('グループを作成')
    .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
    .setOnClickAction(createAction));
  builder.addSection(intro);

  if (groups.length === 0) {
    builder.addSection(CardService.newCardSection()
      .addWidget(CardService.newTextParagraph().setText(
        'まだグループがありません。まずは「グループを作成」からメンバーのメールアドレスを登録してください。'
      )));
    return builder.build();
  }

  groups.forEach((group) => {
    const section = CardService.newCardSection()
      .setHeader(group.name)
      .addWidget(CardService.newTextParagraph()
        .setText('<b>メンバー</b><br>' + group.emails.join('<br>')));

    const buttons = CardService.newButtonSet();

    const addAction = CardService.newAction()
      .setFunctionName('addGroupAttendeesToEvent')
      .setParameters({ groupId: group.id });
    buttons.addButton(CardService.newTextButton()
      .setText('ゲストに追加')
      .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
      .setDisabled(!isEventOpen || !canAddAttendees_(e))
      .setOnClickAction(addAction));

    const deleteAction = CardService.newAction()
      .setFunctionName('deleteGroup')
      .setParameters({ groupId: group.id, isEventOpen: String(isEventOpen) });
    buttons.addButton(CardService.newTextButton()
      .setText('削除')
      .setOnClickAction(deleteAction));

    section.addWidget(buttons);
    builder.addSection(section);
  });

  return builder.build();
}

function showGroupForm(e) {
  const isEventOpen = isEventOpenAction_(e);
  const saveAction = CardService.newAction()
    .setFunctionName('saveGroup')
    .setParameters({ isEventOpen: String(isEventOpen) });

  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader().setTitle('グループを作成'))
    .addSection(CardService.newCardSection()
      .addWidget(CardService.newTextInput()
        .setFieldName('groupName')
        .setTitle('グループ名')
        .setHint('例: 開発チーム'))
      .addWidget(CardService.newTextInput()
        .setFieldName('emails')
        .setTitle('メールアドレス')
        .setHint('1行に1件、またはカンマ区切りで入力')
        .setMultiline(true))
      .addWidget(CardService.newButtonSet()
        .addButton(CardService.newTextButton()
          .setText('保存')
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
          .setOnClickAction(saveAction))
        .addButton(CardService.newTextButton()
          .setText('戻る')
          .setOnClickAction(CardService.newAction().setFunctionName('backToGroupList')))));

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().pushCard(card.build()))
    .build();
}

function saveGroup(e) {
  const values = e.commonEventObject.formInputs || {};
  const name = getStringInput_(values, 'groupName').trim();
  const emails = parseEmails_(getStringInput_(values, 'emails'));

  if (!name || emails.length === 0) {
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('グループ名とメールアドレスを入力してください。'))
      .build();
  }

  const groups = getGroups_();
  groups.push({
    id: Utilities.getUuid(),
    name,
    emails,
    createdAt: new Date().toISOString()
  });
  saveGroups_(groups);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildGroupListCard(e, isEventOpenAction_(e))))
    .setNotification(CardService.newNotification().setText('グループを保存しました。'))
    .build();
}

function backToGroupList(e) {
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().popToRoot())
    .build();
}

function deleteGroup(e) {
  const groupId = e.commonEventObject.parameters.groupId;
  const groups = getGroups_().filter((group) => group.id !== groupId);
  saveGroups_(groups);

  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation().updateCard(buildGroupListCard(e, isEventOpenAction_(e))))
    .setNotification(CardService.newNotification().setText('グループを削除しました。'))
    .build();
}

function addGroupAttendeesToEvent(e) {
  const groupId = e.commonEventObject.parameters.groupId;
  const group = getGroups_().find((item) => item.id === groupId);
  const emails = group ? group.emails : [];

  return CardService.newCalendarEventActionResponseBuilder()
    .addAttendees(emails)
    .build();
}

function canAddAttendees_(e) {
  return Boolean(e && e.calendar && e.calendar.capabilities && e.calendar.capabilities.canAddAttendees);
}

function isEventOpenAction_(e) {
  const parameters = e && e.commonEventObject && e.commonEventObject.parameters;
  if (parameters && parameters.isEventOpen) {
    return parameters.isEventOpen === 'true';
  }
  return Boolean(e && e.calendar);
}

function getGroups_() {
  const raw = PropertiesService.getUserProperties().getProperty(GROUPS_PROPERTY_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function saveGroups_(groups) {
  PropertiesService.getUserProperties().setProperty(GROUPS_PROPERTY_KEY, JSON.stringify(groups));
}

function getStringInput_(formInputs, fieldName) {
  const input = formInputs[fieldName];
  if (!input || !input.stringInputs || !input.stringInputs.value) {
    return '';
  }
  return input.stringInputs.value[0] || '';
}

function parseEmails_(text) {
  const seen = {};
  return text
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    .filter((email) => {
      if (seen[email]) {
        return false;
      }
      seen[email] = true;
      return true;
    });
}
