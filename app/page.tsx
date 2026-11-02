'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { PrimarySidebar } from '@/components/PrimarySidebar';
import { SecondarySidebar } from '@/components/SecondarySidebar';
import { Toaster } from '@/components/Toaster';
import { useTripStore } from '@/store/useTripStore';

// MapLibre touches `window` on import, so the canvas is client-only.
const MapCanvas = dynamic(() => import('@/components/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[#0e0e10]">
      <div className="size-6 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-500" />
    </div>
  ),
});

export default function Home() {
  const init = useTripStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <main className="flex h-screen w-screen overflow-hidden bg-zinc-950 text-zinc-100">
      <PrimarySidebar />
      <SecondarySidebar />
      <section className="relative z-10 h-full min-w-0 flex-1" aria-label="Map">
        <MapCanvas />
      </section>
      <Toaster />
    </main>
  );
}
