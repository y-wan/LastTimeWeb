export const iconCatalogue = [
  'event', 'history', 'favorite', 'health', 'medical', 'medication', 'fitness',
  'running', 'cycling', 'sleep', 'mindfulness', 'water', 'meal', 'coffee', 'pets',
  'family', 'children', 'friends', 'call', 'book', 'movie', 'music', 'travel',
  'car', 'home', 'cleaning', 'work', 'study', 'shopping', 'payment', 'celebration',
  'birthday', 'creative', 'quit_smoking', 'punctuality', 'bed', 'grooming',
  'air_conditioner', 'furniture', 'shower', 'air', 'laundry'
] as const

const aliases: Record<string, string> = {
  clock: 'event',
  general: 'event',
  routine: 'history',
  social: 'celebration',
  paw: 'pets',
  dog: 'pets',
  cat: 'pets',
  bone: 'pets',
  scissors: 'grooming',
  'air-conditioner': 'air_conditioner',
  bath: 'shower',
  food: 'meal',
  exercise: 'fitness',
  clothes: 'laundry',
  plants: 'home',
  spray: 'cleaning'
}

export function normalizeIconKey(icon: string) {
  return aliases[icon] ?? icon
}

const labels = {
  en: {
    event: 'General', history: 'Routine', favorite: 'Favorite', health: 'Health',
    medical: 'Medical', medication: 'Medication', fitness: 'Fitness', running: 'Running',
    cycling: 'Cycling', sleep: 'Sleep', mindfulness: 'Mindfulness', water: 'Water',
    meal: 'Meal', coffee: 'Coffee', pets: 'Pets', family: 'Family', children: 'Children',
    friends: 'Friends', call: 'Call', book: 'Book', movie: 'Movie', music: 'Music',
    travel: 'Travel', car: 'Car', home: 'Home', cleaning: 'Cleaning', work: 'Work',
    study: 'Study', shopping: 'Shopping', payment: 'Payment', celebration: 'Social',
    birthday: 'Birthday', creative: 'Creative', quit_smoking: 'Quit smoking',
    punctuality: 'Punctuality', bed: 'Bed', grooming: 'Grooming',
    air_conditioner: 'Air conditioner', furniture: 'Furniture', shower: 'Shower',
    air: 'Fresh air', laundry: 'Laundry'
  },
  'zh-CN': {
    event: '通用', history: '日常', favorite: '收藏', health: '健康', medical: '医疗',
    medication: '用药', fitness: '健身', running: '跑步', cycling: '骑行', sleep: '睡眠',
    mindfulness: '正念', water: '饮水', meal: '用餐', coffee: '咖啡', pets: '宠物',
    family: '家人', children: '孩子', friends: '朋友', call: '电话', book: '阅读',
    movie: '电影', music: '音乐', travel: '旅行', car: '汽车', home: '居家',
    cleaning: '清洁', work: '工作', study: '学习', shopping: '购物', payment: '付款',
    celebration: '社交', birthday: '生日', creative: '创作', quit_smoking: '戒烟',
    punctuality: '准时', bed: '床品', grooming: '日常理容', air_conditioner: '空调',
    furniture: '家具', shower: '淋浴', air: '通风', laundry: '洗衣'
  }
} as const

export function iconLabel(icon: string, locale: keyof typeof labels) {
  const normalized = normalizeIconKey(icon)
  return labels[locale][normalized as keyof typeof labels.en] ?? normalized
}
