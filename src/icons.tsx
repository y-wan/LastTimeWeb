import schedule from '@material-symbols/svg-400/rounded/schedule.svg'
import event from '@material-symbols/svg-400/rounded/event.svg'
import history from '@material-symbols/svg-400/rounded/history.svg'
import favorite from '@material-symbols/svg-400/rounded/favorite.svg'
import health from '@material-symbols/svg-400/rounded/health_and_safety.svg'
import medical from '@material-symbols/svg-400/rounded/medical_services.svg'
import medication from '@material-symbols/svg-400/rounded/medication.svg'
import fitness from '@material-symbols/svg-400/rounded/fitness_center.svg'
import running from '@material-symbols/svg-400/rounded/directions_run.svg'
import cycling from '@material-symbols/svg-400/rounded/directions_bike.svg'
import sleep from '@material-symbols/svg-400/rounded/bedtime.svg'
import mindfulness from '@material-symbols/svg-400/rounded/self_improvement.svg'
import pets from '@material-symbols/svg-400/rounded/pets.svg'
import bed from '@material-symbols/svg-400/rounded/bed.svg'
import grooming from '@material-symbols/svg-400/rounded/content_cut.svg'
import car from '@material-symbols/svg-400/rounded/directions_car.svg'
import cleaning from '@material-symbols/svg-400/rounded/cleaning_services.svg'
import airConditioner from '@material-symbols/svg-400/rounded/mode_fan.svg'
import furniture from '@material-symbols/svg-400/rounded/chair.svg'
import shower from '@material-symbols/svg-400/rounded/shower.svg'
import air from '@material-symbols/svg-400/rounded/air.svg'
import laundry from '@material-symbols/svg-400/rounded/local_laundry_service.svg'
import water from '@material-symbols/svg-400/rounded/water_drop.svg'
import home from '@material-symbols/svg-400/rounded/home.svg'
import meal from '@material-symbols/svg-400/rounded/restaurant.svg'
import coffee from '@material-symbols/svg-400/rounded/coffee.svg'
import family from '@material-symbols/svg-400/rounded/family_restroom.svg'
import children from '@material-symbols/svg-400/rounded/child_care.svg'
import friends from '@material-symbols/svg-400/rounded/group.svg'
import call from '@material-symbols/svg-400/rounded/call.svg'
import book from '@material-symbols/svg-400/rounded/menu_book.svg'
import movie from '@material-symbols/svg-400/rounded/movie.svg'
import music from '@material-symbols/svg-400/rounded/music_note.svg'
import travel from '@material-symbols/svg-400/rounded/flight.svg'
import shopping from '@material-symbols/svg-400/rounded/shopping_basket.svg'
import work from '@material-symbols/svg-400/rounded/work.svg'
import study from '@material-symbols/svg-400/rounded/school.svg'
import payment from '@material-symbols/svg-400/rounded/payments.svg'
import celebration from '@material-symbols/svg-400/rounded/celebration.svg'
import birthday from '@material-symbols/svg-400/rounded/cake.svg'
import creative from '@material-symbols/svg-400/rounded/palette.svg'
import quitSmoking from '@material-symbols/svg-400/rounded/smoke_free.svg'
import add from '@material-symbols/svg-400/rounded/add.svg'
import check from '@material-symbols/svg-400/rounded/check.svg'
import settings from '@material-symbols/svg-400/rounded/settings.svg'
import search from '@material-symbols/svg-400/rounded/search.svg'
import upload from '@material-symbols/svg-400/rounded/upload.svg'
import download from '@material-symbols/svg-400/rounded/download.svg'
import back from '@material-symbols/svg-400/rounded/arrow_back.svg'
import edit from '@material-symbols/svg-400/rounded/edit.svg'
import deleteIcon from '@material-symbols/svg-400/rounded/delete.svg'
import hardDrive from '@material-symbols/svg-400/rounded/hard_drive.svg'
import wifi from '@material-symbols/svg-400/rounded/wifi.svg'
import wifiOff from '@material-symbols/svg-400/rounded/wifi_off.svg'
import { normalizeIconKey } from './iconCatalogue'

const icons = {
  clock: schedule,
  event,
  history,
  favorite,
  health,
  medical,
  medication,
  fitness,
  running,
  cycling,
  sleep,
  mindfulness,
  pets,
  bed,
  grooming,
  car,
  cleaning,
  air_conditioner: airConditioner,
  furniture,
  shower,
  air,
  laundry,
  water,
  home,
  meal,
  coffee,
  family,
  children,
  friends,
  call,
  book,
  movie,
  music,
  travel,
  shopping,
  work,
  study,
  payment,
  celebration,
  birthday,
  creative,
  quit_smoking: quitSmoking,
  punctuality: schedule,
  add,
  check,
  settings,
  search,
  upload,
  download,
  back,
  edit,
  delete: deleteIcon,
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
