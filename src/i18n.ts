import type { Locale } from './types'

const translations = {
  en: {
    appName: 'Last Time', subtitle: 'When did I last…?', addEvent: 'Add event', events: 'Events',
    history: 'History', settings: 'Settings', markNow: 'Mark now', edit: 'Edit', delete: 'Delete',
    save: 'Save', cancel: 'Cancel', name: 'Name', note: 'Note', optional: 'Optional',
    icon: 'Icon', color: 'Color', eventDetails: 'Event details', occurrences: 'Occurrences',
    addOccurrence: 'Add occurrence', occurredAt: 'Date & time', undo: 'Undo', marked: 'Marked',
    today: 'Today', recent: 'Recent 7 days', earlier: 'Earlier', never: 'Never recorded',
    empty: 'Add something you want to remember.', noHistory: 'No occurrence history yet.',
    language: 'Language', appearance: 'Appearance', system: 'System', light: 'Light', dark: 'Dark',
    data: 'Data', import: 'Import CSV', export: 'Export CSV', sync: 'OneDrive sync',
    signIn: 'Sign in with Microsoft', signOut: 'Sign out', syncNow: 'Sync now',
    offline: 'Offline', syncing: 'Syncing…', synced: 'Synced', syncError: 'Sync error',
    syncSucceeded: 'Synced',
    deviceOnly: 'Saved on this device only', notSyncedYet: 'Not synced yet',
    offlineWaiting: 'Offline, waiting to sync', retry: 'Retry',
    lastSynced: 'Last synced', neverSynced: 'Never synced',
    confirmDeleteEvent: 'Delete this event and its history?', confirmDeleteOccurrence: 'Delete this occurrence?',
    futureError: 'Occurrence time cannot be in the future.', imported: 'Import complete.',
    clientIdMissing: 'Set VITE_MS_CLIENT_ID to enable OneDrive sync.',
    signedIn: 'Connected to OneDrive App Folder', checkingAccount: 'Checking Microsoft account…',
    updateAvailable: 'New version available', updateNow: 'Update now', updating: 'Updating…', later: 'Later',
    search: 'Search events', clear: 'Clear'
  },
  'zh-CN': {
    appName: '上次', subtitle: '我上次做这件事是什么时候？', addEvent: '添加事项', events: '事项',
    history: '历史', settings: '设置', markNow: '记为刚刚', edit: '编辑', delete: '删除',
    save: '保存', cancel: '取消', name: '名称', note: '备注', optional: '选填',
    icon: '图标', color: '颜色', eventDetails: '事项详情', occurrences: '记录',
    addOccurrence: '添加记录', occurredAt: '日期和时间', undo: '撤销', marked: '已记录',
    today: '今天', recent: '最近 7 天', earlier: '更早', never: '从未记录',
    empty: '添加一件你想记住上次时间的事。', noHistory: '还没有历史记录。',
    language: '语言', appearance: '外观', system: '跟随系统', light: '浅色', dark: '深色',
    data: '数据', import: '导入 CSV', export: '导出 CSV', sync: 'OneDrive 同步',
    signIn: '登录 Microsoft', signOut: '退出登录', syncNow: '立即同步',
    offline: '离线', syncing: '同步中…', synced: '已同步', syncError: '同步错误',
    syncSucceeded: '同步完成',
    deviceOnly: '仅保存在此设备', notSyncedYet: '尚未同步',
    offlineWaiting: '离线，等待同步', retry: '重试',
    lastSynced: '上次同步', neverSynced: '尚未同步',
    confirmDeleteEvent: '删除此事项及其历史记录？', confirmDeleteOccurrence: '删除此条记录？',
    futureError: '记录时间不能晚于现在。', imported: '导入完成。',
    clientIdMissing: '设置 VITE_MS_CLIENT_ID 后可启用 OneDrive 同步。',
    signedIn: '已连接 OneDrive 应用文件夹', checkingAccount: '正在检查 Microsoft 帐户…',
    updateAvailable: '发现新版本', updateNow: '立即更新', updating: '正在更新…', later: '稍后',
    search: '搜索事项', clear: '清除'
  }
} as const

export function translator(locale: Locale) {
  return (key: keyof typeof translations.en) => translations[locale][key]
}
