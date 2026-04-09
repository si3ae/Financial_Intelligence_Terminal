// deno-lint-ignore-file
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface PortfolioPosition {
  symbol: string;
  name: string;
  buyPrice: number;
  quantity: number;
  currency: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, stockContext, portfolioContext, locale } = await req.json();

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');

    // ─── Portfolio summary ────────────────────────────────────────────────────
    const portfolioBlock = portfolioContext && portfolioContext.length > 0
      ? `\nUser's current portfolio (${portfolioContext.length} position${portfolioContext.length > 1 ? 's' : ''}):\n` +
        (portfolioContext as PortfolioPosition[]).map((p: PortfolioPosition) =>
          `  - ${p.name} (${p.symbol}): ${p.quantity} shares @ ${p.currency === 'KRW' ? '₩' : '$'}${p.buyPrice.toLocaleString()} avg cost`
        ).join('\n')
      : '\nUser has no open portfolio positions.';

    const systemPrompt = `You are a professional financial investment analyst assistant embedded in a Bloomberg-style terminal.
You analyze stocks, markets, and economic data to provide concise, actionable insights.

Current context:
- Selected stock: ${stockContext?.symbol || 'N/A'} (${stockContext?.name || 'N/A'})
- Stock currency: ${stockContext?.currency || 'USD'}
- User locale: ${locale || 'en'}
${portfolioBlock}

Guidelines:
- Respond in the language matching the locale (ko=Korean, en=English, zh=Chinese, ja=Japanese, de=German, fr=French, it=Italian, gb=English)
- Keep responses concise and data-driven (max 200 words)
- Use bullet points for clarity
- When the user asks about their portfolio, reference the specific positions listed above
- If the user asks about a stock they hold, factor in their average cost basis in your analysis
- Include relevant financial metrics when discussing stocks
- Always caveat that this is not financial advice
- Format numbers professionally with appropriate currency symbols`;

    // ─── Gemini API — convert OpenAI message format to Gemini contents format ──
    // Gemini uses { role: 'user'|'model', parts: [{ text }] } instead of
    // { role: 'user'|'assistant', content: string }.
    // The system prompt is passed as a separate systemInstruction field.
    const contents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.7,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', response.status, errText);

      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again shortly.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ error: `Gemini API error: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ─── Re-stream Gemini SSE as OpenAI-compatible SSE ────────────────────────
    // Gemini SSE chunks look like:
    //   data: {"candidates":[{"content":{"parts":[{"text":"chunk"}],"role":"model"}},...]}
    //
    // The frontend AIAssistantPanel expects OpenAI-format chunks:
    //   data: {"choices":[{"delta":{"content":"chunk"}}]}
    //
    // We transform on the fly so the frontend requires no changes.
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    (async () => {
      const reader = response.body!.getReader();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') {
              await writer.write(encoder.encode('data: [DONE]\n\n'));
              continue;
            }
            try {
              const parsed = JSON.parse(jsonStr);
              const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                // Convert to OpenAI delta format expected by AIAssistantPanel
                const openAIChunk = JSON.stringify({
                  choices: [{ delta: { content: text } }],
                });
                await writer.write(encoder.encode(`data: ${openAIChunk}\n\n`));
              }
            } catch {
              // Malformed chunk — skip
            }
          }
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'));
      } catch (e) {
        console.error('Stream error:', e);
      } finally {
        await writer.close();
      }
    })();

    return new Response(readable, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (e) {
    console.error('ai-assistant error:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
