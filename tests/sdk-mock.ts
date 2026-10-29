// Stand-in for npm:@base44/sdk in tests. Each test sets globalThis.__mock.
export function createClientFromRequest(_req: Request) {
  const m = (globalThis as any).__mock;
  return {
    auth: { me: async () => m.user },
    asServiceRole: { integrations: { Core: { InvokeLLM: async (args: any) => { m.calls.push(args); return m.llm(args, m.calls.length); } } } },
  };
}
