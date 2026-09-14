<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConfigStore, DEFAULT_KEYBOARD_SHORTCUTS, type KeyboardShortcuts } from '../../stores/config'
import { showConfirm } from '../../composables/useConfirm'
import { SettingsPage, SettingsGroup, SettingRow, SettingNotice } from './kit'
import { acceleratorsConflict, keyEventToAccelerator } from '../../utils/shortcut'

const { t } = useI18n()
const configStore = useConfigStore()

const isMac = navigator.platform.toLowerCase().includes('mac')
const isSteamBuild = __STEAM_BUILD__

type ShortcutAction = keyof KeyboardShortcuts

// newAssistantTab 不在此列：它已是「跟随当前位置新建」，无助手的 Steam 版仍能用它开终端
const AI_ACTIONS: ShortcutAction[] = ['toggleAiPanel', 'toggleKnowledge', 'aiDebugConsole', 'voiceInput']

const COMPOSER_ACTIONS: ShortcutAction[] = ['sendMessage', 'queueFollowUp']

const allActions: ShortcutAction[] = ([
  'sendMessage',
  'queueFollowUp',
  'newAssistantTab',
  'newLocalTerminal',
  'newSshConnection',
  'toggleSidebar',
  'navBack',
  'navForward',
  'toggleAiPanel',
  'toggleKnowledge',
  'openFileManager',
  'clearTerminal',
  'batchCommand',
  'openSettings',
  'aiDebugConsole',
  'voiceInput',
  'splitHorizontal',
  'splitVertical',
  'closePane',
] as ShortcutAction[]).filter(a => !isSteamBuild || !AI_ACTIONS.includes(a))

// 按用途分组：十几条快捷键平铺成一堵墙，找不到想改的那条
const ACTION_GROUPS: ReadonlyArray<{ titleKey: string; descKey?: string; actions: ShortcutAction[] }> = [
  {
    titleKey: 'shortcutSettings.groupComposer',
    descKey: 'shortcutSettings.groupComposerHint',
    actions: [...COMPOSER_ACTIONS],
  },
  {
    titleKey: 'shortcutSettings.groupOpen',
    actions: ['newAssistantTab', 'newLocalTerminal', 'newSshConnection', 'openFileManager', 'batchCommand', 'openSettings'],
  },
  {
    titleKey: 'shortcutSettings.groupView',
    actions: ['toggleSidebar', 'toggleAiPanel', 'toggleKnowledge', 'navBack', 'navForward'],
  },
  {
    titleKey: 'shortcutSettings.groupPane',
    actions: ['splitHorizontal', 'splitVertical', 'closePane', 'clearTerminal'],
  },
  {
    titleKey: 'shortcutSettings.groupOther',
    actions: ['voiceInput', 'aiDebugConsole'],
  },
]

// Steam 版会过滤掉部分动作，整组空掉就不显示
const visibleGroups = computed(() =>
  ACTION_GROUPS.map((g) => ({
    titleKey: g.titleKey,
    descKey: g.descKey,
    actions: g.actions.filter((a) => allActions.includes(a)),
  })).filter((g) => g.actions.length > 0)
)

function isComposerAction(action: ShortcutAction): boolean {
  return COMPOSER_ACTIONS.includes(action)
}

const HOLD_KEY_ACTIONS: ShortcutAction[] = ['voiceInput']

function isHoldKeyAction(action: ShortcutAction): boolean {
  return HOLD_KEY_ACTIONS.includes(action)
}

function isVoiceInput(action: ShortcutAction): boolean {
  return action === 'voiceInput'
}

const recordingAction = ref<ShortcutAction | null>(null)
const conflictMessage = ref<string>('')

// 同时支持 CmdOrCtrl（用户录制的） 和 Cmd / Ctrl 字面量（DEFAULT 中分屏快捷键的平台专属
// 写法）。Option 是 Alt 在 mac 上的别名。
const KEY_DISPLAY_MAP: Record<string, string> = isMac
  ? {
      CmdOrCtrl: '⌘', CommandOrControl: '⌘',
      Cmd: '⌘', Command: '⌘', Meta: '⌘',
      Ctrl: '⌃', Control: '⌃',
      Shift: '⇧', Alt: '⌥', Option: '⌥',
      Enter: '↵',
    }
  : {
      CmdOrCtrl: 'Ctrl', CommandOrControl: 'Ctrl',
      Cmd: 'Cmd', Command: 'Cmd', Meta: 'Win',
      Ctrl: 'Ctrl', Control: 'Ctrl',
      Shift: 'Shift', Alt: 'Alt', Option: 'Alt',
      Enter: 'Enter',
    }

function acceleratorToKeys(accelerator: string): string[] {
  if (!accelerator) return []
  const parts = accelerator.split('+')
  return parts.map(part => KEY_DISPLAY_MAP[part] ?? part)
}

function findConflict(accelerator: string, excludeAction: ShortcutAction): ShortcutAction | null {
  if (!accelerator) return null
  for (const action of allActions) {
    if (action === excludeAction) continue
    if (acceleratorsConflict(configStore.keyboardShortcuts[action], accelerator)) {
      return action
    }
  }
  return null
}

const RESERVED_ACCELERATORS = [
  'CmdOrCtrl+W',
  'Command+Q',
  'CmdOrCtrl+Q',
  'CmdOrCtrl+=',
  'CmdOrCtrl+Plus',
  'CmdOrCtrl+-',
  'CmdOrCtrl+0',
]

function isReservedAccelerator(accelerator: string): boolean {
  return RESERVED_ACCELERATORS.some(reserved => acceleratorsConflict(reserved, accelerator))
}

function startRecording(action: ShortcutAction) {
  recordingAction.value = action
  conflictMessage.value = ''
}

function handleKeydown(e: KeyboardEvent, action: ShortcutAction) {
  if (recordingAction.value !== action) return

  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'Escape') {
    recordingAction.value = null
    conflictMessage.value = ''
    return
  }

  if (isHoldKeyAction(action)) {
    const modifiers = ['Control', 'Meta', 'Shift', 'Alt']
    if (!modifiers.includes(e.key)) return
    const keyValue = e.key
    conflictMessage.value = ''
    const newShortcuts = { ...configStore.keyboardShortcuts, [action]: keyValue }
    configStore.setKeyboardShortcuts(newShortcuts)
    recordingAction.value = null
    return
  }

  const accelerator = keyEventToAccelerator(e, { allowBareEnter: isComposerAction(action) })
  if (!accelerator) return

  if (isReservedAccelerator(accelerator)) {
    conflictMessage.value = t('shortcutSettings.reservedConflict')
    return
  }

  const conflict = findConflict(accelerator, action)
  if (conflict) {
    conflictMessage.value = t('shortcutSettings.conflict', {
      action: t(`shortcutSettings.actions.${conflict}`)
    })
    return
  }

  conflictMessage.value = ''
  const newShortcuts = { ...configStore.keyboardShortcuts, [action]: accelerator }
  configStore.setKeyboardShortcuts(newShortcuts)
  recordingAction.value = null
}

function clearShortcut(action: ShortcutAction, e: Event) {
  e.stopPropagation()
  recordingAction.value = null
  const newShortcuts = { ...configStore.keyboardShortcuts, [action]: '' }
  configStore.setKeyboardShortcuts(newShortcuts)
  conflictMessage.value = ''
}

function resetShortcut(action: ShortcutAction, e: Event) {
  e.stopPropagation()
  recordingAction.value = null
  const next = DEFAULT_KEYBOARD_SHORTCUTS[action]
  const conflict = findConflict(next, action)
  if (conflict) {
    conflictMessage.value = t('shortcutSettings.conflict', {
      action: t(`shortcutSettings.actions.${conflict}`)
    })
    return
  }
  const newShortcuts = {
    ...configStore.keyboardShortcuts,
    [action]: next
  }
  configStore.setKeyboardShortcuts(newShortcuts)
  conflictMessage.value = ''
}

async function resetAll() {
  const confirmed = await showConfirm({
    type: 'warning',
    title: t('common.confirm'),
    message: t('shortcutSettings.resetAllConfirm'),
  })
  if (confirmed) {
    recordingAction.value = null
    configStore.setKeyboardShortcuts({ ...DEFAULT_KEYBOARD_SHORTCUTS })
    conflictMessage.value = ''
  }
}

const isModified = computed(() => {
  return allActions.some(
    action => configStore.keyboardShortcuts[action] !== DEFAULT_KEYBOARD_SHORTCUTS[action]
  )
})

function isActionModified(action: ShortcutAction): boolean {
  return configStore.keyboardShortcuts[action] !== DEFAULT_KEYBOARD_SHORTCUTS[action]
}
</script>

<template>
  <SettingsPage :title="t('settings.tabs.shortcuts')" :desc="t('shortcutSettings.description')">
    <template v-if="isModified" #actions>
      <button class="btn btn-sm" @click="resetAll">{{ t('shortcutSettings.resetAll') }}</button>
    </template>

    <SettingNotice v-if="conflictMessage" tone="warn">{{ conflictMessage }}</SettingNotice>

    <SettingsGroup
      v-for="group in visibleGroups"
      :key="group.titleKey"
      :title="t(group.titleKey)"
      :desc="group.descKey ? t(group.descKey) : undefined"
    >
      <SettingRow
        v-for="action in group.actions"
        :key="action"
        :class="{ 'is-modified': isActionModified(action) }"
        :label="t(`shortcutSettings.actions.${action}`)"
        :desc="isHoldKeyAction(action) && configStore.keyboardShortcuts[action] ? t('shortcutSettings.holdToTalk') : undefined"
      >
        <button
          v-if="configStore.keyboardShortcuts[action]"
          class="btn-action"
          :title="t('shortcutSettings.clear')"
          @click="clearShortcut(action, $event)"
        >✕</button>
        <button
          v-if="isActionModified(action)"
          class="btn-action btn-reset"
          :title="t('shortcutSettings.reset')"
          @click="resetShortcut(action, $event)"
        >↺</button>
        <div
          class="shortcut-recorder"
          :class="{
            recording: recordingAction === action,
            empty: !configStore.keyboardShortcuts[action],
          }"
          tabindex="0"
          :title="isVoiceInput(action) ? t('shortcutSettings.voiceInputHint') : undefined"
          @click="startRecording(action)"
          @keydown="handleKeydown($event, action)"
        >
          <template v-if="recordingAction === action">
            <span class="recording-text">{{ isHoldKeyAction(action) ? t('shortcutSettings.recordingModifier') : isComposerAction(action) ? t('shortcutSettings.recordingComposer') : t('shortcutSettings.recording') }}</span>
          </template>
          <template v-else-if="configStore.keyboardShortcuts[action]">
            <span class="keycap-group">
              <kbd
                v-for="(key, i) in acceleratorToKeys(configStore.keyboardShortcuts[action])"
                :key="i"
                class="keycap"
              >{{ key }}</kbd>
            </span>
          </template>
          <template v-else-if="isVoiceInput(action)">
            <span class="empty-text">{{ t('shortcutSettings.voiceInputOff') }}</span>
          </template>
          <template v-else>
            <span class="empty-text">{{ t('shortcutSettings.clickToSet') }}</span>
          </template>
        </div>
      </SettingRow>
    </SettingsGroup>
  </SettingsPage>
</template>

<style scoped>
/* 改过默认值的那一条要静态可辨，不能只靠悬停才浮现的按钮 */
.is-modified :deep(.sf-row-label) {
  color: var(--accent-primary);
}

/* 清除 / 恢复默认：平时藏起来，指到这一行才浮现，避免十几行按钮抢注意力 */
:deep(.sf-row):hover .btn-action,
.btn-action:focus-visible {
  opacity: 1;
}

.btn-action {
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  font-size: 12px;
  color: var(--text-muted);
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.btn-action:hover {
  color: var(--text-primary);
  background: var(--bg-primary);
}

.btn-action.btn-reset:hover {
  color: var(--accent-primary);
}

/* 录制区域 */
.shortcut-recorder {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 120px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--bg-primary);
  cursor: pointer;
  outline: none;
  transition: all 0.15s ease;
}

.shortcut-recorder:hover {
  border-color: var(--border-color);
}

.shortcut-recorder:focus,
.shortcut-recorder.recording {
  border-color: var(--accent-primary);
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb, 100, 149, 237), 0.15);
}

.shortcut-recorder.recording {
  background: rgba(var(--accent-rgb, 100, 149, 237), 0.06);
}

.shortcut-recorder.empty {
  background: transparent;
  border: 1px dashed color-mix(in srgb, var(--border-color) 70%, transparent);
}

.shortcut-recorder.empty:hover {
  border-color: var(--text-muted);
  background: var(--bg-primary);
}

.recording-text {
  font-size: 11px;
  color: var(--accent-primary);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

.empty-text {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.6;
}

/* 按键样式 */
.keycap-group {
  display: flex;
  align-items: center;
  gap: 3px;
}

.keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 20px;
  padding: 0 5px;
  font-size: 11px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', var(--font-mono, monospace);
  font-weight: 500;
  color: var(--text-primary);
  background: linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%);
  border: 1px solid var(--border-color);
  border-bottom-width: 2px;
  border-radius: 4px;
  line-height: 1;
  text-align: center;
}

/* 冲突提示 */

</style>
