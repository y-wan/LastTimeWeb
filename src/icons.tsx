import schedule from '@material-symbols/svg-400/rounded/schedule.svg'
import pets from '@material-symbols/svg-400/rounded/pets.svg'
import dog from '@material-symbols/svg-400/rounded/sound_detection_dog_barking.svg'
import cat from '@material-symbols/svg-400/rounded/cruelty_free.svg'
import bone from '@material-symbols/svg-400/rounded/nutrition.svg'
import bed from '@material-symbols/svg-400/rounded/bed.svg'
import grooming from '@material-symbols/svg-400/rounded/content_cut.svg'
import car from '@material-symbols/svg-400/rounded/directions_car.svg'
import cleaning from '@material-symbols/svg-400/rounded/cleaning_services.svg'
import airConditioner from '@material-symbols/svg-400/rounded/mode_fan.svg'
import furniture from '@material-symbols/svg-400/rounded/chair.svg'
import shower from '@material-symbols/svg-400/rounded/shower.svg'
import air from '@material-symbols/svg-400/rounded/air.svg'
import laundry from '@material-symbols/svg-400/rounded/local_laundry_service.svg'
import bath from '@material-symbols/svg-400/rounded/bathtub.svg'
import water from '@material-symbols/svg-400/rounded/water_drop.svg'
import home from '@material-symbols/svg-400/rounded/home.svg'
import food from '@material-symbols/svg-400/rounded/restaurant.svg'
import shopping from '@material-symbols/svg-400/rounded/shopping_basket.svg'
import health from '@material-symbols/svg-400/rounded/health_and_safety.svg'
import exercise from '@material-symbols/svg-400/rounded/fitness_center.svg'
import clothes from '@material-symbols/svg-400/rounded/checkroom.svg'
import plants from '@material-symbols/svg-400/rounded/local_florist.svg'
import spray from '@material-symbols/svg-400/rounded/sanitizer.svg'
import add from '@material-symbols/svg-400/rounded/add.svg'
import check from '@material-symbols/svg-400/rounded/check.svg'
import settings from '@material-symbols/svg-400/rounded/settings.svg'
import search from '@material-symbols/svg-400/rounded/search.svg'
import upload from '@material-symbols/svg-400/rounded/upload.svg'
import download from '@material-symbols/svg-400/rounded/download.svg'
import back from '@material-symbols/svg-400/rounded/arrow_back.svg'
import edit from '@material-symbols/svg-400/rounded/edit.svg'
import deleteIcon from '@material-symbols/svg-400/rounded/delete.svg'
import event from '@material-symbols/svg-400/rounded/event.svg'
import hardDrive from '@material-symbols/svg-400/rounded/hard_drive.svg'
import wifi from '@material-symbols/svg-400/rounded/wifi.svg'
import wifiOff from '@material-symbols/svg-400/rounded/wifi_off.svg'
import { normalizeIconKey } from './iconCatalogue'

const icons = {
  clock: schedule,
  pets,
  dog,
  cat,
  bone,
  bed,
  grooming,
  car,
  cleaning,
  air_conditioner: airConditioner,
  furniture,
  shower,
  air,
  laundry,
  bath,
  water,
  home,
  food,
  shopping,
  health,
  exercise,
  clothes,
  plants,
  spray,
  add,
  check,
  settings,
  search,
  upload,
  download,
  back,
  edit,
  delete: deleteIcon,
  event,
  hardDrive,
  wifi,
  wifiOff
} as const

export type MaterialIconName = keyof typeof icons

export function MaterialIcon({ name, size = 24 }: { name: MaterialIconName; size?: number }) {
  return <span
    aria-hidden="true"
    className="material-icon"
    data-material-symbol={name}
    style={{
      width: size,
      height: size,
      WebkitMaskImage: `url("${icons[name]}")`,
      maskImage: `url("${icons[name]}")`
    }}
  />
}

export function EventIcon({ name, size = 24 }: { name: string; size?: number }) {
  const normalized = normalizeIconKey(name)
  const icon = normalized in icons ? normalized as MaterialIconName : 'clock'
  return <MaterialIcon name={icon} size={size} />
}
