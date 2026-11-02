import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PIN_CATEGORIES,
  type NewProjectInput,
  type PinCategory,
  type PinPlacement,
  type PinUpdate,
  type Project,
  type ProjectPin,
  type ProjectUpdate,
} from '@/types/trip';
import { buildSeedData, type SeedData } from '@/lib/seed';

/* -------------------------------------------------------------------------- */
/*  Database typing                                                            */
/* -------------------------------------------------------------------------- */

// Mapped types (rather than the interfaces themselves) satisfy supabase-js's
// `Record<string, unknown>` row constraint.
type Row<T> = { [K in keyof T]: T[K] };

/**
 * What PostgREST actually returns for `project_pins`: `category` and `cost` have
 * defaults but no NOT NULL, and `numeric` may arrive as a string.
 */
type PinRow = Row<Omit<ProjectPin, 'category' | 'cost'> & { category: PinCategory | null; cost: number | string | null }>;

type ProjectInsert = Row<NewProjectInput & { id?: string; user_id?: string | null; created_at?: string }>;
type PinInsert = Row<
  Omit<ProjectPin, 'id' | 'address' | 'category' | 'day_date' | 'sort_order' | 'notes' | 'cost' | 'created_at'> &
    Partial<Pick<ProjectPin, 'id' | 'address' | 'category' | 'day_date' | 'sort_order' | 'notes' | 'cost' | 'created_at'>>
>;

export interface Database {
  public: {
    Tables: {
      projects: {
        Row: Row<Project>;
        Insert: ProjectInsert;
        Update: Row<Partial<ProjectInsert>>;
        Relationships: [];
      };
      project_pins: {
        Row: PinRow;
        Insert: PinInsert;
        Update: Row<Partial<PinInsert>>;
        Relationships: [
          {
            foreignKeyName: 'project_pins_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

export type TripSupabaseClient = SupabaseClient<Database>;

/* -------------------------------------------------------------------------- */
/*  Client initialisation                                                      */
/* -------------------------------------------------------------------------- */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let browserClient: TripSupabaseClient | null = null;

export function getSupabaseClient(): TripSupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  browserClient ??= createBrowserClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY);
  return browserClient;
}

/* -------------------------------------------------------------------------- */
/*  Row normalisation                                                          */
/* -------------------------------------------------------------------------- */

/** NULL falls back to the column default; anything unexpected to `other`. */
function toCategory(value: string | null): PinCategory {
  if (value === null) return 'sightseeing';
  return PIN_CATEGORIES.find((category) => category === value) ?? 'other';
}

/** PostgREST can serialise `numeric` / `double precision` as strings; coerce defensively. */
function toProject(row: Project): Project {
  return { ...row, center_lat: Number(row.center_lat), center_lng: Number(row.center_lng) };
}

function toPin(row: PinRow): ProjectPin {
  const cost = Number(row.cost ?? 0);
  return {
    ...row,
    lat: Number(row.lat),
    lng: Number(row.lng),
    cost: Number.isFinite(cost) ? cost : 0,
    sort_order: Number(row.sort_order ?? 0),
    category: toCategory(row.category),
  };
}

/* -------------------------------------------------------------------------- */
/*  Service contract                                                           */
/* -------------------------------------------------------------------------- */

export type DataMode = 'supabase' | 'demo';

/**
 * Every write accepts a client-generated UUID, so optimistic records never need
 * a temp-id → server-id swap.
 */
export interface TripService {
  readonly mode: DataMode;
  listProjects(): Promise<Project[]>;
  createProject(project: Project): Promise<Project>;
  updateProject(id: string, patch: ProjectUpdate): Promise<Project>;
  deleteProject(id: string): Promise<void>;
  listPins(projectId: string): Promise<ProjectPin[]>;
  createPin(pin: ProjectPin): Promise<ProjectPin>;
  updatePin(id: string, patch: PinUpdate): Promise<ProjectPin>;
  deletePin(id: string): Promise<void>;
  savePlacements(placements: PinPlacement[]): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/*  Supabase implementation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Talks to the anon role directly: the dev-mode RLS policies are permissive, so there
 * is no auth gate. `projects.user_id` falls back to `auth.uid()` (null for anon).
 */
class SupabaseTripService implements TripService {
  readonly mode = 'supabase' as const;

  constructor(private readonly client: TripSupabaseClient) {}

  async listProjects(): Promise<Project[]> {
    const { data, error } = await this.client.from('projects').select('*').order('start_date', { ascending: false });
    if (error) throw error;
    return data.map(toProject);
  }

  async createProject(project: Project): Promise<Project> {
    const { data, error } = await this.client
      .from('projects')
      .insert({
        id: project.id,
        title: project.title,
        destination_name: project.destination_name,
        center_lat: project.center_lat,
        center_lng: project.center_lng,
        start_date: project.start_date,
        end_date: project.end_date,
      })
      .select('*')
      .single();
    if (error) throw error;
    return toProject(data);
  }

  async updateProject(id: string, patch: ProjectUpdate): Promise<Project> {
    const { data, error } = await this.client.from('projects').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return toProject(data);
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.client.from('projects').delete().eq('id', id);
    if (error) throw error;
  }

  async listPins(projectId: string): Promise<ProjectPin[]> {
    const { data, error } = await this.client
      .from('project_pins')
      .select('*')
      .eq('project_id', projectId)
      .order('day_date', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return data.map(toPin);
  }

  async createPin(pin: ProjectPin): Promise<ProjectPin> {
    const { created_at: _createdAt, ...insert } = pin;
    const { data, error } = await this.client.from('project_pins').insert(insert).select('*').single();
    if (error) throw error;
    return toPin(data);
  }

  async updatePin(id: string, patch: PinUpdate): Promise<ProjectPin> {
    const { data, error } = await this.client.from('project_pins').update(patch).eq('id', id).select('*').single();
    if (error) throw error;
    return toPin(data);
  }

  async deletePin(id: string): Promise<void> {
    const { error } = await this.client.from('project_pins').delete().eq('id', id);
    if (error) throw error;
  }

  async savePlacements(placements: PinPlacement[]): Promise<void> {
    if (placements.length === 0) return;
    const results = await Promise.all(
      placements.map(({ id, day_date, sort_order }) =>
        this.client.from('project_pins').update({ day_date, sort_order }).eq('id', id),
      ),
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Demo implementation (no env vars): seed data persisted to localStorage     */
/* -------------------------------------------------------------------------- */

const DEMO_STORAGE_KEY = 'wayfarer:demo:v1';
const DEMO_LATENCY_MS = 160;

class LocalTripService implements TripService {
  readonly mode = 'demo' as const;
  private memory: SeedData | null = null;

  private read(): SeedData {
    if (this.memory) return this.memory;
    try {
      const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (isSeedData(parsed)) {
          this.memory = parsed;
          return parsed;
        }
      }
    } catch {
      // Storage blocked or corrupt: fall through to fresh seed data.
    }
    this.memory = buildSeedData();
    this.write(this.memory);
    return this.memory;
  }

  private write(data: SeedData): void {
    this.memory = data;
    try {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Private mode / quota: keep working from memory.
    }
  }

  private async tick(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, DEMO_LATENCY_MS));
  }

  async listProjects(): Promise<Project[]> {
    await this.tick();
    return [...this.read().projects].sort((a, b) => b.start_date.localeCompare(a.start_date));
  }

  async createProject(project: Project): Promise<Project> {
    await this.tick();
    const data = this.read();
    this.write({ ...data, projects: [...data.projects, project] });
    return project;
  }

  async updateProject(id: string, patch: ProjectUpdate): Promise<Project> {
    await this.tick();
    const data = this.read();
    const current = data.projects.find((p) => p.id === id);
    if (!current) throw new Error('Trip not found');
    const next = { ...current, ...patch };
    this.write({ ...data, projects: data.projects.map((p) => (p.id === id ? next : p)) });
    return next;
  }

  async deleteProject(id: string): Promise<void> {
    await this.tick();
    const data = this.read();
    this.write({
      projects: data.projects.filter((p) => p.id !== id),
      pins: data.pins.filter((pin) => pin.project_id !== id),
    });
  }

  async listPins(projectId: string): Promise<ProjectPin[]> {
    await this.tick();
    return this.read().pins.filter((pin) => pin.project_id === projectId);
  }

  async createPin(pin: ProjectPin): Promise<ProjectPin> {
    await this.tick();
    const data = this.read();
    this.write({ ...data, pins: [...data.pins, pin] });
    return pin;
  }

  async updatePin(id: string, patch: PinUpdate): Promise<ProjectPin> {
    await this.tick();
    const data = this.read();
    const current = data.pins.find((pin) => pin.id === id);
    if (!current) throw new Error('Place not found');
    const next = { ...current, ...patch };
    this.write({ ...data, pins: data.pins.map((pin) => (pin.id === id ? next : pin)) });
    return next;
  }

  async deletePin(id: string): Promise<void> {
    await this.tick();
    const data = this.read();
    this.write({ ...data, pins: data.pins.filter((pin) => pin.id !== id) });
  }

  async savePlacements(placements: PinPlacement[]): Promise<void> {
    await this.tick();
    const byId = new Map(placements.map((p) => [p.id, p]));
    const data = this.read();
    this.write({
      ...data,
      pins: data.pins.map((pin) => {
        const placement = byId.get(pin.id);
        return placement ? { ...pin, day_date: placement.day_date, sort_order: placement.sort_order } : pin;
      }),
    });
  }
}

function isSeedData(value: unknown): value is SeedData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { projects?: unknown }).projects) &&
    Array.isArray((value as { pins?: unknown }).pins)
  );
}

/* -------------------------------------------------------------------------- */
/*  Public entry point                                                         */
/* -------------------------------------------------------------------------- */

let service: TripService | null = null;

/** Supabase when env vars are present, otherwise the localStorage demo backend. */
export function getTripService(): TripService {
  if (service) return service;
  const client = getSupabaseClient();
  service = client ? new SupabaseTripService(client) : new LocalTripService();
  return service;
}

/** All trips, newest `start_date` first. */
export function getProjects(): Promise<Project[]> {
  return getTripService().listProjects();
}

/** A trip's pins ordered by `day_date` (Saved Places last), then `sort_order`. */
export function getProjectPins(projectId: string): Promise<ProjectPin[]> {
  return getTripService().listPins(projectId);
}

export function resetDemoData(): void {
  try {
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
  } catch {
    // ignore
  }
}
