import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

// AI Client Finder: every AI call in the app goes through here (InvokeLLM is blocked in the browser).
// Optional file_urls (up to 8 uploaded screenshots) are passed to the AI with the prompt.

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => null);
    const prompt = body?.prompt;
    const response_json_schema = body?.response_json_schema;
    if (!prompt || typeof prompt !== 'string') {
      return Response.json({ error: 'prompt is required' }, { status: 400 });
    }
    if (prompt.length > 60000) {
      return Response.json({ error: 'prompt is too long' }, { status: 400 });
    }
    const file_urls = (Array.isArray(body?.file_urls) ? body.file_urls : [])
      .filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
      .slice(0, 8);

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      ...(response_json_schema ? { response_json_schema } : {}),
      ...(file_urls.length ? { file_urls } : {}),
    });

    return Response.json({ result });
  } catch (error) {
    return Response.json({ error: (error as Error)?.message || 'Something went wrong.' }, { status: 500 });
  }
}
