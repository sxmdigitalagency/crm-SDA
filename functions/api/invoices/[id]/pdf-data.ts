import { json, toId } from '../../../lib/http';
import { pdfData } from '../../../lib/pdf-data';
import type { Handler } from '../../../lib/types';

export const onRequestGet: Handler = async ({ params, env }) => json(await pdfData(env.DB, 'invoice', toId(params.id)));
