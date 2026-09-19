import {
  AirVent, Armchair, Bath, BedDouble, Bone, Car, Cat, Clock3, Dog, Droplets,
  Dumbbell, HeartPulse, House, PawPrint, Scissors, Shirt, ShoppingBasket,
  ShowerHead, Sparkles, SprayCan, Trees, Utensils, WashingMachine, Wind
} from 'lucide-react'

const icons = {
  clock: Clock3,
  paw: PawPrint,
  dog: Dog,
  cat: Cat,
  bone: Bone,
  bed: BedDouble,
  scissors: Scissors,
  car: Car,
  cleaning: Sparkles,
  'air-conditioner': AirVent,
  furniture: Armchair,
  shower: ShowerHead,
  air: Wind,
  laundry: WashingMachine,
  bath: Bath,
  water: Droplets,
  home: House,
  food: Utensils,
  shopping: ShoppingBasket,
  health: HeartPulse,
  exercise: Dumbbell,
  clothes: Shirt,
  plants: Trees,
  spray: SprayCan
}

export function EventIcon({ name, size = 24 }: { name: string; size?: number }) {
  const Icon = icons[name as keyof typeof icons] ?? Clock3
  return <Icon size={size} strokeWidth={2} />
}
