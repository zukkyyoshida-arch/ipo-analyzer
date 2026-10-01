// 旧URL（apollo-ipo）への全リクエストを、新URL（kabu-radar）の同じパス・クエリへ 301 転送する。
const NEW_ORIGIN = "https://kabu-radar.zukky-yoshida.workers.dev";

const worker = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    return Response.redirect(`${NEW_ORIGIN}${url.pathname}${url.search}`, 301);
  },
};

export default worker;
