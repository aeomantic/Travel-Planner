import { addDays } from 'date-fns';
import type { PinCategory, Project, ProjectPin } from '@/types/trip';
import { toISODate } from '@/lib/utils';

interface SeedPin {
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: PinCategory;
  /** 0-based day within the trip; `null` = Saved Places. */
  day: number | null;
  cost: number;
  notes?: string;
}

interface SeedTrip {
  id: string;
  title: string;
  destination_name: string;
  center_lat: number;
  center_lng: number;
  /** Start date relative to today, so the demo always has upcoming and past trips. */
  startOffsetDays: number;
  lengthDays: number;
  pins: SeedPin[];
}

const SEED_TRIPS: SeedTrip[] = [
  {
    id: '6f1c8a52-0b7e-4c1a-9a51-3c1f0f7d2a01',
    title: 'Tokyo Autumn Escape',
    destination_name: 'Tokyo, Japan',
    center_lat: 35.6762,
    center_lng: 139.6503,
    startOffsetDays: 16,
    lengthDays: 6,
    pins: [
      { name: 'Haneda Airport', address: 'Ota City, Tokyo', lat: 35.5494, lng: 139.7798, category: 'transit', day: 0, cost: 12, notes: 'Keikyu line to Shinagawa, then JR.' },
      { name: 'Park Hyatt Tokyo', address: '3-7-1-2 Nishishinjuku, Shinjuku', lat: 35.6856, lng: 139.6907, category: 'hotel', day: 0, cost: 480, notes: 'Check-in from 3pm. Ask for a Fuji-view room.' },
      { name: 'Omoide Yokocho', address: '1 Chome-2 Nishishinjuku, Shinjuku', lat: 35.693, lng: 139.6995, category: 'food', day: 0, cost: 35 },
      { name: 'Meiji Jingu', address: '1-1 Yoyogikamizonocho, Shibuya', lat: 35.6764, lng: 139.6993, category: 'sightseeing', day: 1, cost: 0 },
      { name: 'Shibuya Crossing', address: 'Shibuya City, Tokyo', lat: 35.6595, lng: 139.7005, category: 'sightseeing', day: 1, cost: 0 },
      { name: 'Ichiran Shibuya', address: '1 Chome-22-7 Jinnan, Shibuya', lat: 35.661, lng: 139.7016, category: 'food', day: 1, cost: 18 },
      { name: 'Shibuya Sky', address: '2-24-12 Shibuya, Shibuya City', lat: 35.6585, lng: 139.7023, category: 'sightseeing', day: 1, cost: 22, notes: 'Book the sunset slot ~2 weeks ahead.' },
      { name: 'Tsukiji Outer Market', address: '4 Chome-16-2 Tsukiji, Chuo City', lat: 35.6654, lng: 139.7707, category: 'food', day: 2, cost: 40 },
      { name: 'teamLab Planets', address: '6 Chome-1-16 Toyosu, Koto City', lat: 35.6491, lng: 139.7898, category: 'sightseeing', day: 2, cost: 28 },
      { name: 'Ginza Six', address: '6 Chome-10-1 Ginza, Chuo City', lat: 35.6696, lng: 139.7639, category: 'other', day: 2, cost: 120 },
      { name: 'Senso-ji', address: '2 Chome-3-1 Asakusa, Taito City', lat: 35.7148, lng: 139.7967, category: 'sightseeing', day: 3, cost: 0 },
      { name: 'Tokyo Skytree', address: '1 Chome-1-2 Oshiage, Sumida City', lat: 35.7101, lng: 139.8107, category: 'sightseeing', day: 3, cost: 25 },
      { name: 'Akihabara Electric Town', address: 'Sotokanda, Chiyoda City', lat: 35.6984, lng: 139.7731, category: 'other', day: 3, cost: 60 },
      { name: 'Shinjuku Gyoen', address: '11 Naitomachi, Shinjuku City', lat: 35.6852, lng: 139.7101, category: 'sightseeing', day: 4, cost: 4 },
      { name: 'Golden Gai', address: '1 Chome-1-6 Kabukicho, Shinjuku', lat: 35.6938, lng: 139.7046, category: 'food', day: 4, cost: 45 },
      { name: 'Tokyo Station', address: '1 Chome Marunouchi, Chiyoda City', lat: 35.6812, lng: 139.7671, category: 'transit', day: 5, cost: 15 },
      { name: 'Ghibli Museum', address: '1 Chome-1-83 Shimorenjaku, Mitaka', lat: 35.6962, lng: 139.5704, category: 'sightseeing', day: null, cost: 8, notes: 'Tickets release on the 10th of the prior month.' },
      { name: 'Nakameguro Canal', address: 'Kamimeguro, Meguro City', lat: 35.644, lng: 139.699, category: 'sightseeing', day: null, cost: 0 },
      { name: 'Shimokitazawa', address: 'Kitazawa, Setagaya City', lat: 35.6616, lng: 139.668, category: 'other', day: null, cost: 0 },
      { name: 'Afuri Ebisu', address: '1 Chome-1-7 Ebisu, Shibuya City', lat: 35.648, lng: 139.71, category: 'food', day: null, cost: 12 },
    ],
  },
  {
    id: '6f1c8a52-0b7e-4c1a-9a51-3c1f0f7d2a02',
    title: 'Lisbon Long Weekend',
    destination_name: 'Lisbon, Portugal',
    center_lat: 38.7223,
    center_lng: -9.1393,
    startOffsetDays: 45,
    lengthDays: 4,
    pins: [
      { name: 'Memmo Alfama', address: 'Travessa das Merceeiras 27, Lisboa', lat: 38.711, lng: -9.1306, category: 'hotel', day: 0, cost: 210 },
      { name: 'Castelo de São Jorge', address: 'R. de Santa Cruz do Castelo, Lisboa', lat: 38.7139, lng: -9.1335, category: 'sightseeing', day: 0, cost: 15 },
      { name: 'Miradouro da Senhora do Monte', address: 'Largo Monte, Lisboa', lat: 38.7191, lng: -9.1327, category: 'sightseeing', day: 0, cost: 0, notes: 'Best sunset view in the city.' },
      { name: 'Torre de Belém', address: 'Av. Brasília, Lisboa', lat: 38.6916, lng: -9.216, category: 'sightseeing', day: 1, cost: 10 },
      { name: 'Mosteiro dos Jerónimos', address: 'Praça do Império, Lisboa', lat: 38.6979, lng: -9.2068, category: 'sightseeing', day: 1, cost: 12 },
      { name: 'Pastéis de Belém', address: 'R. de Belém 84-92, Lisboa', lat: 38.6975, lng: -9.2032, category: 'food', day: 1, cost: 8 },
      { name: 'LX Factory', address: 'R. Rodrigues de Faria 103, Lisboa', lat: 38.7037, lng: -9.1784, category: 'other', day: 1, cost: 0 },
      { name: 'Praça do Comércio', address: 'Praça do Comércio, Lisboa', lat: 38.7076, lng: -9.1365, category: 'sightseeing', day: 2, cost: 0 },
      { name: 'Time Out Market', address: 'Av. 24 de Julho 49, Lisboa', lat: 38.7071, lng: -9.1458, category: 'food', day: 2, cost: 30 },
      { name: 'Lisbon Airport', address: 'Alameda das Comunidades Portuguesas', lat: 38.7742, lng: -9.1342, category: 'transit', day: 3, cost: 2 },
      { name: 'Palácio da Pena', address: 'Estrada da Pena, Sintra', lat: 38.7876, lng: -9.3906, category: 'sightseeing', day: null, cost: 20 },
      { name: 'Tram 28', address: 'Martim Moniz, Lisboa', lat: 38.7163, lng: -9.1359, category: 'transit', day: null, cost: 3 },
      { name: 'Cervejaria Ramiro', address: 'Av. Almirante Reis 1, Lisboa', lat: 38.7209, lng: -9.1358, category: 'food', day: null, cost: 45 },
    ],
  },
  {
    id: '6f1c8a52-0b7e-4c1a-9a51-3c1f0f7d2a03',
    title: 'Kyoto Cherry Blossoms',
    destination_name: 'Kyoto, Japan',
    center_lat: 35.0116,
    center_lng: 135.7681,
    startOffsetDays: -205,
    lengthDays: 4,
    pins: [
      { name: 'Kyoto Station', address: 'Shimogyo Ward, Kyoto', lat: 34.9858, lng: 135.7588, category: 'transit', day: 0, cost: 0 },
      { name: 'The Thousand Kyoto', address: '570 Higashishiokojicho, Shimogyo Ward', lat: 34.9863, lng: 135.7596, category: 'hotel', day: 0, cost: 260 },
      { name: 'Fushimi Inari Taisha', address: '68 Fukakusa Yabunouchicho, Fushimi Ward', lat: 34.9671, lng: 135.7727, category: 'sightseeing', day: 0, cost: 0 },
      { name: 'Kiyomizu-dera', address: '1 Chome-294 Kiyomizu, Higashiyama Ward', lat: 34.9949, lng: 135.785, category: 'sightseeing', day: 1, cost: 4 },
      { name: 'Gion Shirakawa', address: 'Higashiyama Ward, Kyoto', lat: 35.0055, lng: 135.7754, category: 'sightseeing', day: 1, cost: 0 },
      { name: 'Nishiki Market', address: 'Nakagyo Ward, Kyoto', lat: 35.005, lng: 135.7649, category: 'food', day: 1, cost: 25 },
      { name: 'Arashiyama Bamboo Grove', address: 'Sagaogurayama, Ukyo Ward', lat: 35.017, lng: 135.6713, category: 'sightseeing', day: 2, cost: 0 },
      { name: 'Tenryū-ji', address: '68 Sagatenryuji Susukinobabacho, Ukyo Ward', lat: 35.0156, lng: 135.6738, category: 'sightseeing', day: 2, cost: 5 },
      { name: 'Kinkaku-ji', address: '1 Kinkakujicho, Kita Ward', lat: 35.0394, lng: 135.7292, category: 'sightseeing', day: 2, cost: 4 },
      { name: "Philosopher's Path", address: 'Sakyo Ward, Kyoto', lat: 35.027, lng: 135.7948, category: 'sightseeing', day: 3, cost: 0 },
      { name: 'Nijō Castle', address: '541 Nijojocho, Nakagyo Ward', lat: 35.0142, lng: 135.7482, category: 'sightseeing', day: null, cost: 9 },
    ],
  },
  {
    id: '6f1c8a52-0b7e-4c1a-9a51-3c1f0f7d2a04',
    title: 'New York City Weekend',
    destination_name: 'New York, USA',
    center_lat: 40.7128,
    center_lng: -74.006,
    startOffsetDays: -96,
    lengthDays: 3,
    pins: [
      { name: 'The Standard, High Line', address: '848 Washington St, New York', lat: 40.7408, lng: -74.0078, category: 'hotel', day: 0, cost: 390 },
      { name: 'The High Line', address: 'Gansevoort St to W 34th St', lat: 40.748, lng: -74.0048, category: 'sightseeing', day: 0, cost: 0 },
      { name: 'Chelsea Market', address: '75 9th Ave, New York', lat: 40.7424, lng: -74.0061, category: 'food', day: 0, cost: 30 },
      { name: 'Central Park', address: 'Manhattan, New York', lat: 40.7829, lng: -73.9654, category: 'sightseeing', day: 1, cost: 0 },
      { name: 'The Met', address: '1000 5th Ave, New York', lat: 40.7794, lng: -73.9632, category: 'sightseeing', day: 1, cost: 30 },
      { name: "Joe's Pizza", address: '7 Carmine St, New York', lat: 40.7306, lng: -74.0021, category: 'food', day: 1, cost: 8 },
      { name: 'Brooklyn Bridge', address: 'Brooklyn Bridge, New York', lat: 40.7061, lng: -73.9969, category: 'sightseeing', day: 2, cost: 0 },
      { name: 'JFK Airport', address: 'Queens, New York', lat: 40.6413, lng: -73.7781, category: 'transit', day: 2, cost: 70 },
    ],
  },
];

export interface SeedData {
  projects: Project[];
  pins: ProjectPin[];
}

/** Builds demo data with dates relative to `today`. */
export function buildSeedData(today: Date = new Date()): SeedData {
  const createdAt = today.toISOString();
  const projects: Project[] = [];
  const pins: ProjectPin[] = [];

  for (const trip of SEED_TRIPS) {
    const start = addDays(today, trip.startOffsetDays);
    projects.push({
      id: trip.id,
      user_id: null,
      title: trip.title,
      destination_name: trip.destination_name,
      center_lat: trip.center_lat,
      center_lng: trip.center_lng,
      start_date: toISODate(start),
      end_date: toISODate(addDays(start, trip.lengthDays - 1)),
      created_at: createdAt,
    });

    const orderByBucket = new Map<number | null, number>();
    trip.pins.forEach((pin, i) => {
      const order = orderByBucket.get(pin.day) ?? 0;
      orderByBucket.set(pin.day, order + 1);
      pins.push({
        // Deterministic UUIDs: trip prefix + `b0` + trip suffix + pin index.
        id: `${trip.id.slice(0, 24)}b0${trip.id.slice(-2)}${String(i).padStart(8, '0')}`,
        project_id: trip.id,
        name: pin.name,
        address: pin.address,
        lat: pin.lat,
        lng: pin.lng,
        category: pin.category,
        day_date: pin.day === null ? null : toISODate(addDays(start, pin.day)),
        sort_order: order,
        notes: pin.notes ?? null,
        cost: pin.cost,
        created_at: createdAt,
      });
    });
  }

  return { projects, pins };
}
