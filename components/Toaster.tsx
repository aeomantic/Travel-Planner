'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CircleAlert, Info, X } from 'lucide-react';
import { useTripStore } from '@/store/useTripStore';
import { cn } from '@/lib/utils';

export function Toaster() {
  const notices = useTripStore((s) => s.notices);
  const dismiss = useTripStore((s) => s.dismissNotice);

  return (
    <div className="pointer-events-none fixed bottom-20 left-1/2 md:bottom-5 z-50 flex w-[min(420px,calc(100vw-32px))] -translate-x-1/2 flex-col items-center gap-2">
      <AnimatePresence initial={false}>
        {notices.map((notice) => (
          <motion.div
            key={notice.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            role={notice.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-2xl backdrop-blur-md',
              notice.tone === 'error'
                ? 'border-rose-500/30 bg-rose-950/80 text-rose-100'
                : 'border-zinc-700/60 bg-zinc-900/90 text-zinc-100',
            )}
          >
            {notice.tone === 'error' ? (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-400" />
            ) : (
              <Info className="mt-0.5 size-4 shrink-0 text-indigo-400" />
            )}
            <p className="flex-1 leading-snug">{notice.message}</p>
            {notice.action && (
              <button
                type="button"
                onClick={() => {
                  notice.action?.run();
                  dismiss(notice.id);
                }}
                className="-my-0.5 rounded-md px-2 py-0.5 text-xs font-semibold text-indigo-300 transition-colors hover:bg-indigo-500/15"
              >
                {notice.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => dismiss(notice.id)}
              className="-mr-1 rounded-md p-0.5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-zinc-100"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
