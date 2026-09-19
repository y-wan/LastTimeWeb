export const iconCatalogue = [
  'clock', 'pets', 'dog', 'cat', 'bone', 'bed', 'grooming', 'car', 'cleaning',
  'air_conditioner', 'furniture', 'shower', 'air', 'laundry', 'bath', 'water',
  'home', 'food', 'shopping', 'health', 'exercise', 'clothes', 'plants', 'spray'
] as const

const aliases: Record<string, string> = {
  paw: 'pets',
  scissors: 'grooming',
  'air-conditioner': 'air_conditioner'
}

export function normalizeIconKey(icon: string) {
  return aliases[icon] ?? icon
}

const labels = {
  en: {
    clock: 'Time', pets: 'Pet', dog: 'Dog', cat: 'Cat', bone: 'Pet care', bed: 'Bed',
    grooming: 'Grooming', car: 'Car', cleaning: 'Cleaning', air_conditioner: 'Air conditioner',
    furniture: 'Furniture', shower: 'Shower', air: 'Fresh air', laundry: 'Laundry', bath: 'Bath',
    water: 'Water', home: 'Home', food: 'Food', shopping: 'Shopping', health: 'Health',
    exercise: 'Exercise', clothes: 'Clothes', plants: 'Plants', spray: 'Spray'
  },
  'zh-CN': {
    clock: '时间', pets: '宠物', dog: '狗狗', cat: '猫咪', bone: '宠物护理', bed: '床品',
    grooming: '日常理容', car: '汽车', cleaning: '清洁', air_conditioner: '空调',
    furniture: '家具', shower: '淋浴', air: '通风', laundry: '洗衣', bath: '洗澡',
    water: '饮水', home: '居家', food: '饮食', shopping: '购物', health: '健康',
    exercise: '运动', clothes: '衣物', plants: '植物', spray: '喷洒'
  }
} as const

export function iconLabel(icon: string, locale: keyof typeof labels) {
  const normalized = normalizeIconKey(icon)
  return labels[locale][normalized as keyof typeof labels.en] ?? normalized
}
