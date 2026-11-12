'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export function BrandMark({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <img
      src="/icons/bilifit-logo.png"
      alt="Bilifit"
      draggable={false}
      className={cx('shrink-0 select-none rounded-[26%] shadow-card object-cover', className)}
    />
  );
}

export const inputCls =
  'w-full px-3.5 py-2.5 rounded-btn border border-line bg-raised text-ink placeholder:text-ink3 ' +
  'focus:border-accent focus:ring-2 focus:ring-accent/20 outline-none transition-all text-sm';

export const selectCls =
  'px-3 py-2.5 rounded-btn border border-line bg-raised text-ink text-sm outline-none ' +
  'focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all';

export const labelCls = 'block text-sm font-semibold text-ink2 mb-1.5';

export const btnPrimary =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-btn bg-primary text-onprimary ' +
  'text-sm font-semibold hover:bg-primaryhover active:scale-[0.98] transition-all shadow-card ' +
  'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100';

export const btnGhost =
  'inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-btn bg-sunken text-ink2 ' +
  'text-sm font-semibold hover:bg-line/60 hover:text-ink active:scale-[0.98] transition-all ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

export const btnSoft =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-btn bg-accent/10 text-accent ' +
  'text-xs font-bold hover:bg-accent/20 active:scale-[0.97] transition-all';

export const iconBtn =
  'p-2 rounded-btn text-ink3 hover:text-ink hover:bg-sunken active:scale-95 transition-all';

export const cardCls = 'bg-surface rounded-card border border-line shadow-card';

interface ModalProps {
  title: string;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}

export function Modal({ title, icon, onClose, children, footer, maxWidth = 'max-w-lg' }: ModalProps) {
  const [viewportStyle, setViewportStyle] = useState<CSSProperties>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const visualViewport = window.visualViewport;
    const syncViewport = () => {
      if (!visualViewport) return;
      setViewportStyle({
        top: `${visualViewport.offsetTop}px`,
        height: `${visualViewport.height}px`,
        bottom: 'auto',
      });
    };
    syncViewport();
    visualViewport?.addEventListener('resize', syncViewport);
    visualViewport?.addEventListener('scroll', syncViewport);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      visualViewport?.removeEventListener('resize', syncViewport);
      visualViewport?.removeEventListener('scroll', syncViewport);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 backdrop-blur-sm animate-fade-in [overscroll-behavior:contain] sm:items-center sm:p-4"
      style={viewportStyle}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-bilifit-modal="true"
    >
      <div
        className={cx(
          'bg-surface w-full max-h-[92%] flex flex-col border border-line2 shadow-pop animate-pop-in',
          'rounded-t-[22px] sm:rounded-card overflow-hidden',
          maxWidth
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0" aria-hidden>
          <span className="w-10 h-1.5 rounded-full bg-line2" />
        </div>
        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 border-b border-line bg-surface shrink-0">
          <h2 className="font-display text-lg font-semibold text-ink flex items-center gap-2.5">
            {icon && <span className="w-8 h-8 rounded-btn bg-accent/10 text-accent flex items-center justify-center shrink-0">{icon}</span>}
            {title}
          </h2>
          <button type="button" onClick={onClose} className={iconBtn} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="px-5 sm:px-6 py-4 border-t border-line bg-sunken/50 shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
