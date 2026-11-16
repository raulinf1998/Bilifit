import type { Routine } from '@/types';

/** Confirma antes de enviar el borrado; nunca elimina si el usuario cancela. */
export async function confirmAndDeleteRoutine(
  routine: Pick<Routine, 'id' | 'name'>,
  confirmDelete: (message: string) => boolean,
  request: typeof fetch
): Promise<'cancelled' | 'deleted'> {
  if (!confirmDelete(`¿Seguro que quieres eliminar la rutina «${routine.name}»? Esta acción no se puede deshacer.`)) {
    return 'cancelled';
  }
  const response = await request(`/api/routines/${encodeURIComponent(routine.id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('No se ha podido eliminar la rutina.');
  return 'deleted';
}
