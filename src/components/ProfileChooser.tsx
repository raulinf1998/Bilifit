'use client';

import { BrandMark } from '@/components/ui';
import { ACCOUNT_SUBTITLES, selectAccount } from '@/lib/accounts';

export function ProfileChooser() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-5">
      <section className="max-w-lg w-full rounded-card border border-line bg-surface p-7 sm:p-8 shadow-lift text-center animate-pop-in">
        <div className="flex justify-center mb-4">
          <BrandMark className="h-14 w-14 shadow-lift" />
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-semibold text-ink">
          Bienvenidos a Bilifit
        </h1>
        <p className="mt-3 text-sm text-ink2 leading-relaxed">
          ¿Quién va a entrenar? Este navegador recordará tu perfil. Podéis cambiarlo en cualquier momento desde la barra lateral o en Ajustes.
        </p>

        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => selectAccount('raul')}
            className="rounded-btn bg-primary text-onprimary p-4 text-left hover:bg-primaryhover active:scale-[0.98] transition-all shadow-card"
          >
            <span className="block text-base font-bold">Raúl</span>
            <span className="mt-1 block text-xs opacity-90 leading-snug">
              {ACCOUNT_SUBTITLES.raul}
            </span>
          </button>

          <button
            type="button"
            onClick={() => selectAccount('pequenaja')}
            className="rounded-btn bg-primary text-onprimary p-4 text-left hover:bg-primaryhover active:scale-[0.98] transition-all shadow-card"
          >
            <span className="block text-base font-bold">Pequeñaja</span>
            <span className="mt-1 block text-xs opacity-90 leading-snug">
              {ACCOUNT_SUBTITLES.pequenaja}
            </span>
          </button>
        </div>

        <p className="mt-5 text-xs text-ink3">
          Los perfiles no tienen contraseña y mantienen actividades, material, apariencia y conexiones totalmente separados.
        </p>
      </section>
    </main>
  );
}
