// 利用量が上限に達したときに本番 Worker（kabu-radar）と差し替える、軽量なメンテ画面。
const HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>カブレーダー 休止中</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:20vh auto;padding:0 1rem;line-height:1.8;color:#222}</style>
</head>
<body>
<h1>カブレーダー 休止中</h1>
<p>カブレーダーは今月の利用上限に達したため、来月 1 日（UTC）まで休止中です。</p>
<p>ご不便をおかけします。再開までしばらくお待ちください。</p>
</body>
</html>`;

const worker = {
  async fetch(request: Request): Promise<Response> {
    const headers = { "Retry-After": "3600", "Cache-Control": "no-store" };
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "maintenance" }), {
        status: 503,
        headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return new Response(HTML, {
      status: 503,
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
    });
  },
};

export default worker;
