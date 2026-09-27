// Point d'entrée navigateur : récupère les données du document, génère le PDF localement.
import { PDF_ASSET_PATHS, renderPdf, type PdfAssets, type PdfDocumentData } from './render';
import type { Settings } from '../types';

let assets: Promise<PdfAssets> | null = null;
function loadAssets(): Promise<PdfAssets> {
  assets ??= Promise.all(
    Object.entries(PDF_ASSET_PATHS).map(async ([key, path]) => {
      const res = await fetch(path, { cache: 'force-cache' });
      if (!res.ok) throw new Error(`Ressource PDF introuvable : ${path}`);
      return [key, new Uint8Array(await res.arrayBuffer())] as const;
    }),
  ).then((e) => Object.fromEntries(e) as unknown as PdfAssets).catch((err) => { assets = null; throw err; });
  return assets;
}

export async function generatePdf(kind: 'quote' | 'invoice', id: number): Promise<{ blob: Blob; filename: string }> {
  const [res, files] = await Promise.all([
    fetch(`/api/${kind === 'quote' ? 'quotes' : 'invoices'}/${id}/pdf-data`, { credentials: 'same-origin' }),
    loadAssets(),
  ]);
  if (res.status === 401) { location.href = `/login/?next=${encodeURIComponent(location.pathname)}`; throw new Error('Session expirée'); }
  const data = (await res.json()) as { document: PdfDocumentData; settings: Settings; filename: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `Erreur ${res.status}`);
  const bytes = await renderPdf(data.document, data.settings, files);
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), filename: data.filename };
}
