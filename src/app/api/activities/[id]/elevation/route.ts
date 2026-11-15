import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { reloadActivityElevation } from '@/lib/elevation-backfill';

/**
 * POST /api/activities/:id/elevation
 *
 * Reconstruye el perfil de altitud de la actividad desde sus coordenadas GPS
 * (modelo digital del terreno), para relojes sin barómetro. El desnivel, las cotas,
 * los splits y el TSS se recalculan a partir del perfil resultante.
 *
 * body (opcional): { refresh?: boolean } — `refresh: true` vuelve a preguntar al
 * servicio en vez de usar la caché local de altitudes.
 */
/** Texto que ve el usuario cuando no hace falta (o no se puede) estimar. */
function skipMessage(reason?: string): string {
  switch (reason) {
    case 'proveedor_desactivado':
      return 'El cálculo de altitud está desactivado en la configuración del servidor (BILIFIT_DEM_URL). Elimina el valor none y reinicia Bilifit para activarlo.';
    case 'ya_estimada':
      return 'El perfil de altitud ya estaba estimado desde el GPS. Pulsa «Volver a estimar» para recalcularlo contra el modelo del terreno.';
    case 'altimetro':
      return 'Este reloj ya registraba altitud: no hace falta estimarla.';
    case 'desnivel':
      return 'La salida ya trae desnivel registrado: la altitud por mapa sólo se aplica a las que no tienen ningún dato de altura.';
    case 'actividad_modificada':
      return 'La actividad cambió durante el cálculo. No se ha modificado; vuelve a intentarlo.';
    case 'interior':
      return 'La altitud por mapa sólo se aplica a salidas de exterior.';
    case 'sin_muestras':
      return 'El recorrido es demasiado corto para estimar cotas con garantías.';
    default:
      return 'Esta salida no tiene suficientes puntos GPS para estimar la altitud.';
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async () => {
    const { id } = await context.params;
    try {
      const body = (await req.json().catch(() => ({}))) as { refresh?: unknown };
      const refresh = body.refresh === true;

      const { result, activity } = await reloadActivityElevation(id, { refresh });

      if (!activity) {
        return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });
      }
      if (result.status === 'error') {
        return NextResponse.json({ error: result.error ?? 'No se pudo estimar la altitud', result }, { status: 502 });
      }
      if (result.status === 'skipped') {
        return NextResponse.json({
          result,
          activity,
          message: skipMessage(result.reason),
        });
      }

      return NextResponse.json({ result, activity });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'No se pudo consultar el modelo de elevaciones' },
        { status: 502 }
      );
    }
  });
}
